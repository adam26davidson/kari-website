# Test deployment environment — one-time setup

The repo side of the test→prod pipeline (issue #227) is in place:
`.github/workflows/deploy.yml` deploys every CI-green merge to the
`kari-website-test` CodeDeploy group and holds the prod deploy behind the
`production` GitHub Environment. This document is the **one-time
AWS/GitHub/Auth0 setup** that has to exist before the first run succeeds.

> **Status (2026-08-18):** executed. Steps 1–7 are done (deployment group
> `kari-website-test` created; IAM and bucket config already covered test;
> DNS, instance config, TLS, and the `production` GitHub environment are
> live). Step 8 (Auth0 origins) remained manual — the local `auth0` CLI
> token had expired. Step 9 runs after this PR merges.

It is written to be executed by a Claude session on a machine with:

- AWS CLI authenticated (`aws sso login`), account `336231940806`,
  region `us-east-2`
- `gh` CLI authenticated as `adam26davidson`
- Access to the Auth0 dashboard (one step is dashboard-only unless the
  `auth0` CLI is set up)

Conventions the pipeline assumes (must match `scripts/deploy/env.sh` and
`appspec.test.yml`):

| Thing | Prod | Test |
|---|---|---|
| Deployment group | `kari-website-cd` | `kari-website-test` |
| Static files | `/home/ubuntu/static-sites/kari-website` | `/home/ubuntu/static-sites/kari-website-test` |
| API binary dir | `/home/ubuntu/kari-api` | `/home/ubuntu/kari-api-test` |
| systemd unit | `kari-api.service` | `kari-api-test.service` |
| API port | 3000 | 3001 |
| Content bucket | `karidavidson.com` | `test.karidavidson.com` |
| Hostname | `karidavidson.com` | `test.karidavidson.com` |

General instruction: several steps say "mirror prod". Inspect the prod
resource first and copy its shape rather than trusting this doc's guesses —
the instance's nginx layout and systemd unit were never checked into the
repo.

```bash
export AWS_REGION=us-east-2
```

## 1. Discover the instance

```bash
# Find the instance the prod deployment group targets, and its public IP.
aws deploy get-deployment-group \
  --application-name kari-website \
  --deployment-group-name kari-website-cd \
  --query 'deploymentGroupInfo.{serviceRole:serviceRoleArn,tagFilters:ec2TagFilters,tagSet:ec2TagSet}'

# Using the tag filter(s) from above (adjust Key/Value):
aws ec2 describe-instances \
  --filters "Name=tag:<Key>,Values=<Value>" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].{Id:InstanceId,Ip:PublicIpAddress,Profile:IamInstanceProfile.Arn}'
```

Keep `INSTANCE_ID`, `PUBLIC_IP`, the service role ARN, and the tag filters
handy:

```bash
INSTANCE_ID=i-...
PUBLIC_IP=...
SERVICE_ROLE_ARN=arn:aws:iam::336231940806:role/...
```

## 2. Create the test CodeDeploy deployment group

Same application, same instance, same service role — only the name differs.
Mirror prod's tag filters exactly (use `--ec2-tag-set` instead if prod uses
a tag *set*).

```bash
aws deploy create-deployment-group \
  --application-name kari-website \
  --deployment-group-name kari-website-test \
  --service-role-arn "$SERVICE_ROLE_ARN" \
  --ec2-tag-filters Key=<Key>,Value=<Value>,Type=KEY_AND_VALUE
```

## 3. Check the CI role can deploy to the new group

The workflow assumes `arn:aws:iam::336231940806:role/kari-website-ci` may
create deployments for the new group. Inspect its policies; if any statement
scopes `codedeploy:*` to the `kari-website-cd` deployment-group ARN
specifically, add
`arn:aws:codedeploy:us-east-2:336231940806:deploymentgroup:kari-website/kari-website-test`
to the same statement. If it's scoped to the application or `*`, nothing to
do.

```bash
aws iam list-attached-role-policies --role-name kari-website-ci
aws iam list-role-policies --role-name kari-website-ci
# then aws iam get-policy-version / get-role-policy on what you find,
# and aws iam put-role-policy / create-policy-version if it needs the new ARN.
```

## 4. Check the instance role can read/write the test bucket

The test API serves content from `test.karidavidson.com` and its `/health`
endpoint probes S3 read+write, so the instance profile role (from step 1)
needs the same S3 permissions on `test.karidavidson.com` +
`test.karidavidson.com/*` that it has on the prod bucket. Inspect and extend
the same way as step 3.

Also confirm the test bucket itself matches prod for public read policy and
CORS (the browser fetches content straight from the bucket). It's already
used by `./scripts/dev.sh --aws`, so this is likely fine — verify:

```bash
aws s3api get-bucket-policy --bucket test.karidavidson.com
aws s3api get-bucket-cors  --bucket test.karidavidson.com
# Compare with the prod bucket; if CORS lists specific origins, add
# https://test.karidavidson.com via aws s3api put-bucket-cors.
```

## 5. DNS: point test.karidavidson.com at the instance

```bash
ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name karidavidson.com \
  --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')

aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{
    \"Name\":\"test.karidavidson.com\",\"Type\":\"A\",\"TTL\":300,
    \"ResourceRecords\":[{\"Value\":\"$PUBLIC_IP\"}]}}]}"
```

(If prod's A record is an alias or the IP isn't an Elastic IP, mirror
whatever prod's record does instead.)

## 6. Instance-side setup (via EC2 Instance Connect)

The instance is NOT registered with SSM, and no private key for it exists
on the dev machine. What works is EC2 Instance Connect: push a throwaway
public key (valid 60 seconds — re-push before every ssh), then ssh as
`ubuntu`:

```bash
ssh-keygen -t ed25519 -f /tmp/eic_key -N '' -q
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$INSTANCE_ID" \
  --availability-zone "$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)" \
  --instance-os-user ubuntu --ssh-public-key file:///tmp/eic_key.pub
ssh -i /tmp/eic_key ubuntu@"$PUBLIC_IP"
```

First, inspect prod's config so the test copies mirror reality:

```bash
cat /etc/systemd/system/kari-api.service
ls /etc/nginx/sites-available/ && cat /etc/nginx/sites-available/<prod vhost>
```

Then:

```bash
# a) Directories the appspec installs into
sudo mkdir -p /home/ubuntu/static-sites/kari-website-test /home/ubuntu/kari-api-test
sudo chown -R ubuntu:ubuntu /home/ubuntu/static-sites/kari-website-test /home/ubuntu/kari-api-test

# b) systemd unit: copy the prod unit, then change three things —
#    ExecStart path -> /home/ubuntu/kari-api-test/kari-website-api,
#    PORT=3001, BUCKET_NAME=test.karidavidson.com. Everything else
#    (User, WorkingDirectory, Environment for region/credentials, Restart)
#    stays as prod has it. If the unit reads an EnvironmentFile, copy that
#    file too and point the test unit at the copy.
sudo cp /etc/systemd/system/kari-api.service /etc/systemd/system/kari-api-test.service
sudo ${EDITOR:-vi} /etc/systemd/system/kari-api-test.service
sudo systemctl daemon-reload
sudo systemctl enable kari-api-test.service
# Don't start it yet — the binary arrives with the first deploy.

# c) nginx vhost: copy the prod server block; change server_name to
#    test.karidavidson.com, root to /home/ubuntu/static-sites/kari-website-test,
#    and the /api proxy_pass upstream port to 3001. Keep the SPA
#    try_files fallback and any other directives identical to prod.
sudo cp /etc/nginx/sites-available/<prod vhost> /etc/nginx/sites-available/test.karidavidson.com
sudo ${EDITOR:-vi} /etc/nginx/sites-available/test.karidavidson.com   # point ssl_certificate* at the step-d cert paths
sudo ln -s /etc/nginx/sites-available/test.karidavidson.com /etc/nginx/sites-enabled/

# d) TLS. certbot's nginx plugin is NOT installed on the instance; prod's
#    cert uses the dns-route53 authenticator (the instance role carries the
#    kari-certbot-dns-route53 policy), so mirror that — it also needs no
#    propagated A record:
sudo certbot certonly --dns-route53 -d test.karidavidson.com -n
#    Cert lands in /etc/letsencrypt/live/test.karidavidson.com/; the vhost
#    from (c) references it. certbot renews via certbot.timer but nothing
#    reloaded nginx afterwards, so add the standard deploy hook (covers
#    prod's cert too):
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

sudo nginx -t && sudo systemctl reload nginx
```

## 7. GitHub: `production` environment with required reviewer

This is what holds the prod deploy until approved (approval works from the
GitHub mobile app — enable notifications for "Deployment reviews").

```bash
USER_ID=$(gh api users/adam26davidson --jq .id)
gh api -X PUT repos/adam26davidson/kari-website/environments/production \
  --input - <<EOF
{"reviewers":[{"type":"User","id":$USER_ID}]}
EOF
```

The `test` environment needs no protection rules; GitHub auto-creates it on
the first run.

## 8. Auth0: allow the test origin

In the Auth0 dashboard (tenant `dev-ivkddn8ec0pdwd5a`, application
`gEuLXgSWSpVoqjJSv5gs5qb2a83Tz0JM`), append `https://test.karidavidson.com`
to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web
Origins**. (Same tenant as prod — admin login on test uses the real admin
account.)

## 9. First deploy and verification

```bash
gh workflow run deploy.yml --repo adam26davidson/kari-website
gh run watch --repo adam26davidson/kari-website
```

- `deploy-test` should go green; check https://test.karidavidson.com loads,
  content renders (S3 fetches work), and admin login works.
- The run then pauses at `deploy-prod` waiting for review — approve it from
  the run page (or phone) and confirm https://karidavidson.com still works.

Optionally refresh test content from prod first:
`./scripts/sync_s3_prod_to_test.sh`.

## Day-to-day notes

- Every merged PR redeploys test automatically, then waits for approval.
  Approve to ship; ignore to leave prod as-is (pending approvals expire
  after 30 days). If several merges pile up, approve only the newest run —
  reject the stale ones so an old commit can't be promoted after a newer
  one by accident.
- The approved prod deploy is the exact commit that ran on test: both
  bundles are built once, up front, from `workflow_run.head_sha`.
