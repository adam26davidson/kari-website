//! Shared test helpers.
//!
//! Files inside a subdirectory of `tests/` are NOT compiled as their own test
//! binaries, so this module can be pulled into each integration test crate with
//! `mod common;` without producing duplicate `#[test]` runs.

pub mod store;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::Client;
use jsonwebtoken::{encode, jwk::JwkSet, Algorithm, EncodingKey, Header};
use kari_website_api::middleware::auth::JwksCache;
use kari_website_api::routes::health::HealthCache;
use kari_website_api::services::object_store::ObjectStore;
use kari_website_api::services::s3::S3Service;
use kari_website_api::AppState;
use serde::Serialize;

/// A throwaway RSA-2048 keypair generated only for tests. The public half is
/// exposed through [`build_jwks`] and the private half signs tokens in
/// [`signed_token`]. This is NOT a real credential.
pub const TEST_KID: &str = "test-key-1";

const TEST_RSA_PRIVATE_PEM: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDPAN+vXHkIa4Fo
f3EV6fdZiYaAJE04dRsWNPV90VLe9pXCn6BcslSCT/gaEkHUm8gVn3JuxySsEKi5
SSmNTPCyh8/5tEBGomLYM6rpEHhrzYXg/Cu4GcQB12LVKaxIVIb0WljnFrAuoDiV
z5JLDXEoqZ20LhIx+JW0hD8Vz1qiC137LQ6jorIAgKpjf03iIqRQApOtQK+v9Ga8
X3XWcJfeLcEgxxWA3qy7yzsU0CGnuKDe4papistLeum+Inyus/YKZ8JyFBWKhGq9
e+m2RAC4CpLCmSoKceXqaZD30j1S23pYohftMQSLTC3B93MC4LRMVEJWeITi8xCh
0wNcK7KlAgMBAAECggEACX8UnY0iuupOdygkXJ+NgSfmid6AeDO8U+4giZt1HFtY
HspanaRxufVOU4kQYfi2lGVdwNH1r2FOEdf9JilIM1lSYKlIBJi8OG2gX6ccuydX
bVOfc6EjXvx0VIUGc6s32LudvGML68urMa/Vpu59YtXrMShzt1apEyCF0cVf0H/o
I4VR0WmkO9Sm+HaGNGZTYfU9roWb9lRiFRbT+ir4QW/b377nh7BDNxrku6v76PwA
U5eUbRl3whFU6NHXbCRVgqz1UyQIShD3a13ZCHDc0ct7Dik9zeZxX+rvKLOzKNze
32hR7An2HJCCEuBbq7Iwz4KKqdfNPcomVQlmOQPJgQKBgQD0qNsnWgqiwDwDHCFO
1wna17gMFaciGE+KZSctUa0ttqBDQrI1Ei3tpTp92qtRME3ViKVS/96xpIEKeZJV
NQ3JJ0+4CpOHhN2kncqIRot1S0B4B9KFUEeEOPtvbwctmoRd7eNcUT1W+wV8kGoS
/5mbi6Ppfc5np2WzeNi5Aoj2gQKBgQDYmS/7T7gy4zqRTzfciiFD0dJXNu7GNTSX
wb4e8QQKIQDt6rghxVdhL6HNwMB9q/th2BJSqcvWmHsHq4/FjpuMeh5JQp2eBpD5
H9Gz3lygiWCxHzdUnNqSINhIMlv7OVlM75NedzU5dE/ihDtg2eUlk2pwZBM5y8ru
oZ/qBYsSJQKBgFzsAQhqJ132+xQHTBNAkwqeIdXdJ3RInXUnxABvZAHXufixzTNg
6za2KYgBVE3qtbUjR/9FFRSNMUGEOPLJyqmal6mDwtKWwQOztmeZu3/aC+tKtUdS
3Ua3ya9iEOzeIeX24wJ+DHkLr+LGirMahwHPwHp/ALTXnEXU4SMrdk+BAoGAZRlr
mgQl2CrT5YtyaZBX4o4Hfgn3/bBL8iHOmiapWgj5pBORCsJP/N78yUsVDhO+bHcs
ZkU3Dd1yX6wmmXHtDO7bQBrF80LhXEcL3McHuS8mYMZPT0E/jEGkcl5/LI4iLpUM
1mUSBNVTjEloZdaO7LEYV4l+p9WFzUjHmbYoqbkCgYEAn5dwEg8BC+ZBOZ+HU2nr
LgUnsuoFcWCxvrI0GZaXDDuU6+mmk04J4E1x3FvdldTYfYSnizPSWLH14eyjQ8n9
GFHX3UYWgUza4ljCEpzBdHNLM7YO+CptHos6dm6tmf0t6nnEeBtdCcH2Zk+3K6NM
2ugQ0SH9r+YLlX7J0mprHWI=
-----END PRIVATE KEY-----"#;

/// base64url-encoded modulus of the test public key (matches the private PEM above).
const TEST_RSA_MODULUS: &str = "zwDfr1x5CGuBaH9xFen3WYmGgCRNOHUbFjT1fdFS3vaVwp-gXLJUgk_4GhJB1JvIFZ9ybsckrBCouUkpjUzwsofP-bRARqJi2DOq6RB4a82F4PwruBnEAddi1SmsSFSG9FpY5xawLqA4lc-SSw1xKKmdtC4SMfiVtIQ_Fc9aogtd-y0Oo6KyAICqY39N4iKkUAKTrUCvr_RmvF911nCX3i3BIMcVgN6su8s7FNAhp7ig3uKWqYrLS3rpviJ8rrP2CmfCchQVioRqvXvptkQAuAqSwpkqCnHl6mmQ99I9Utt6WKIX7TEEi0wtwfdzAuC0TFRCVniE4vMQodMDXCuypQ";

/// Must match the values `validate_token` in `middleware/auth.rs` expects.
pub const EXPECTED_AUDIENCE: &str = "https://api.karidavidson.com/";
pub const EXPECTED_ISSUER: &str = "https://dev-ivkddn8ec0pdwd5a.us.auth0.com/";

/// Build a `JwkSet` containing the test public key under [`TEST_KID`].
pub fn build_jwks() -> JwkSet {
    let value = serde_json::json!({
        "keys": [{
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": TEST_KID,
            "n": TEST_RSA_MODULUS,
            "e": "AQAB",
        }]
    });
    serde_json::from_value(value).expect("test JWKS should deserialize")
}

#[derive(Serialize)]
struct TestClaims {
    aud: String,
    iss: String,
    exp: usize,
}

/// Options for producing a signed JWT so individual tests can deliberately
/// create invalid tokens (wrong key id, expired, wrong audience/issuer).
pub struct TokenOptions {
    pub kid: String,
    pub audience: String,
    pub issuer: String,
    /// Seconds from now until expiry (negative = already expired).
    pub expires_in_secs: i64,
}

impl Default for TokenOptions {
    fn default() -> Self {
        Self {
            kid: TEST_KID.to_string(),
            audience: EXPECTED_AUDIENCE.to_string(),
            issuer: EXPECTED_ISSUER.to_string(),
            expires_in_secs: 3600,
        }
    }
}

/// Sign a JWT with the test private key. With [`TokenOptions::default`] the
/// token is accepted by the real `validate_token`.
pub fn signed_token(opts: TokenOptions) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_secs() as i64;
    let claims = TestClaims {
        aud: opts.audience,
        iss: opts.issuer,
        exp: (now + opts.expires_in_secs).max(0) as usize,
    };
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(opts.kid);
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_PEM.as_bytes())
            .expect("test private key should parse"),
    )
    .expect("token should encode")
}

/// A dummy S3 client with static bogus credentials, pointed at an unroutable
/// endpoint. Tests that only exercise routing / auth never invoke an S3
/// operation; tests that do reach a handler (e.g. a valid token hitting a
/// secure route) fail the S3 call instantly and locally instead of sending
/// signed requests to real AWS, so the suite stays hermetic and fast offline.
// Not every test binary that includes `common` uses these state builders
// (handler_tests builds its state from `store` instead), so allow dead_code.
#[allow(dead_code)]
pub fn dummy_s3_client() -> Client {
    let conf = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-2"))
        .endpoint_url("http://127.0.0.1:1")
        .credentials_provider(Credentials::new(
            "test",
            "test",
            None,
            None,
            "test-provider",
        ))
        .build();
    Client::from_conf(conf)
}

/// Build a real [`AppState`] with the given JWKS and a dummy S3 client. The
/// JWKS refresh URL is unroutable (like the S3 endpoint) so the unknown-kid
/// refresh path fails fast and locally instead of calling the real Auth0.
#[allow(dead_code)]
pub fn test_state(jwks: JwkSet) -> AppState {
    let client = dummy_s3_client();
    let s3_service: Arc<dyn ObjectStore> =
        Arc::new(S3Service::new(client, "test-bucket".to_string()));
    AppState {
        jwks: Arc::new(JwksCache::new(
            jwks,
            "http://127.0.0.1:1/jwks.json".to_string(),
        )),
        s3_service,
        health: Arc::new(HealthCache::default()),
    }
}
