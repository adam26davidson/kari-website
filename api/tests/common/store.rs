//! In-memory `ObjectStore` for handler-level tests, mimicking real S3
//! semantics (get/tag of a missing key -> `NotFound`; delete of a missing key
//! succeeds), plus a switch that makes every operation fail to simulate an
//! outage.
//!
//! This module is compiled into every test binary that declares `mod common;`,
//! but only the handler tests use it — hence the file-level dead_code allow.
#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use jsonwebtoken::jwk::JwkSet;
use kari_website_api::middleware::auth::JwksCache;
use kari_website_api::routes::health::HealthCache;
use kari_website_api::services::object_store::{ObjectMeta, ObjectStore};
use kari_website_api::services::s3::S3Error;
use kari_website_api::AppState;

/// One stored object: its bytes plus the `public` tag recorded by
/// `put_object` / `set_object_tagging`, so tests can assert publish
/// semantics, and its last-modified time so GC tests can exercise the
/// in-flight-upload safety margin.
#[derive(Clone)]
pub struct StoredObject {
    pub data: Vec<u8>,
    pub public: bool,
    pub last_modified: Option<SystemTime>,
}

#[derive(Default)]
pub struct InMemoryStore {
    objects: Mutex<HashMap<String, StoredObject>>,
    fail: AtomicBool,
    fail_puts: AtomicBool,
    fail_gets_for: Mutex<HashSet<String>>,
    /// Key suffixes whose puts fail, leaving every other write working.
    fail_puts_for_suffix: Mutex<HashSet<String>>,
    /// `Some(n)`: the next `n` puts succeed, every later one fails.
    fail_puts_after: Mutex<Option<usize>>,
    /// `Some(n)`: the next `n` deletes succeed, every later one fails.
    fail_deletes_after: Mutex<Option<usize>>,
    /// `Some(n)`: the next `n` copies succeed, every later one fails.
    fail_copies_after: Mutex<Option<usize>>,
}

impl InMemoryStore {
    /// Seed an object (tagged public) before the app runs; chainable. Seeded
    /// objects are backdated a day so pre-existing content is outside the GC
    /// sweep's recent-upload safety margin, like real long-lived objects.
    pub fn with_object(self, key: &str, data: impl Into<Vec<u8>>) -> Self {
        self.with_object_modified_at(
            key,
            data,
            SystemTime::now() - Duration::from_secs(24 * 60 * 60),
        )
    }

    /// Seed an object whose backend reports NO last-modified time, so tests
    /// can pin down the GC sweep's conservative handling of unknown ages.
    pub fn with_object_untimestamped(self, key: &str, data: impl Into<Vec<u8>>) -> Self {
        self.objects.lock().unwrap().insert(
            key.to_string(),
            StoredObject {
                data: data.into(),
                public: true,
                last_modified: None,
            },
        );
        self
    }

    /// Seed an object with an explicit last-modified time; chainable.
    pub fn with_object_modified_at(
        self,
        key: &str,
        data: impl Into<Vec<u8>>,
        last_modified: SystemTime,
    ) -> Self {
        self.objects.lock().unwrap().insert(
            key.to_string(),
            StoredObject {
                data: data.into(),
                public: true,
                last_modified: Some(last_modified),
            },
        );
        self
    }

    /// When set, every subsequent operation fails with `OperationFailed`,
    /// simulating an S3 outage or permission breakage.
    pub fn set_failing(&self, failing: bool) {
        self.fail.store(failing, Ordering::SeqCst);
    }

    /// Fail only writes, leaving reads working — the July 2026 failure mode
    /// the health endpoint's write probe exists to catch.
    pub fn set_failing_puts(&self, failing: bool) {
        self.fail_puts.store(failing, Ordering::SeqCst);
    }

    /// Let the next `count` puts succeed and fail every one after that —
    /// simulates an outage starting between the two writes of a
    /// private-then-public save.
    pub fn set_failing_puts_after(&self, count: usize) {
        *self.fail_puts_after.lock().unwrap() = Some(count);
    }

    /// Let the next `count` deletes succeed and fail every one after that —
    /// simulates an outage starting partway through a GC sweep's deletes.
    pub fn set_failing_deletes_after(&self, count: usize) {
        *self.fail_deletes_after.lock().unwrap() = Some(count);
    }

    /// Let the next `count` copies succeed and fail every one after that —
    /// simulates an outage starting partway through the image migration.
    pub fn set_failing_copies_after(&self, count: usize) {
        *self.fail_copies_after.lock().unwrap() = Some(count);
    }

    /// Seed an object with an explicit `public` tag and last-modified time.
    pub fn with_object_tagged(
        self,
        key: &str,
        data: impl Into<Vec<u8>>,
        public: bool,
        last_modified: SystemTime,
    ) -> Self {
        self.objects.lock().unwrap().insert(
            key.to_string(),
            StoredObject {
                data: data.into(),
                public,
                last_modified: Some(last_modified),
            },
        );
        self
    }

    /// Make `put_object` fail for keys ending in `suffix`, leaving every
    /// other write working — lets a test fail ONE rendition of an upload
    /// whose key carries a server-generated UUID it cannot know in advance.
    pub fn set_failing_puts_for_suffix(&self, suffix: &str) {
        self.fail_puts_for_suffix
            .lock()
            .unwrap()
            .insert(suffix.to_string());
    }

    /// Make `get_object` fail with `OperationFailed` for one specific key,
    /// leaving everything else working — simulates a single unreadable
    /// manifest, which must abort a GC sweep.
    pub fn set_failing_get_for(&self, key: &str) {
        self.fail_gets_for.lock().unwrap().insert(key.to_string());
    }

    pub fn get(&self, key: &str) -> Option<StoredObject> {
        self.objects.lock().unwrap().get(key).cloned()
    }

    pub fn contains(&self, key: &str) -> bool {
        self.objects.lock().unwrap().contains_key(key)
    }

    fn check_fail(&self) -> Result<(), S3Error> {
        if self.fail.load(Ordering::SeqCst) {
            Err(S3Error::OperationFailed("injected failure".to_string()))
        } else {
            Ok(())
        }
    }

    /// Consume one success from a fail-after-N budget: `Ok` while budget
    /// remains (or no limit is set), `Err` once it is exhausted.
    fn check_budget(budget: &Mutex<Option<usize>>, what: &str) -> Result<(), S3Error> {
        match budget.lock().unwrap().as_mut() {
            Some(0) => Err(S3Error::OperationFailed(format!(
                "injected {what} failure after budget exhausted"
            ))),
            Some(remaining) => {
                *remaining -= 1;
                Ok(())
            }
            None => Ok(()),
        }
    }
}

#[async_trait]
impl ObjectStore for InMemoryStore {
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, S3Error> {
        self.check_fail()?;
        if self.fail_gets_for.lock().unwrap().contains(key) {
            return Err(S3Error::OperationFailed(format!(
                "injected get failure for {key}"
            )));
        }
        self.objects
            .lock()
            .unwrap()
            .get(key)
            .map(|o| o.data.clone())
            .ok_or(S3Error::NotFound)
    }

    async fn put_object(&self, key: &str, data: Vec<u8>, public: bool) -> Result<(), S3Error> {
        self.check_fail()?;
        if self.fail_puts.load(Ordering::SeqCst) {
            return Err(S3Error::OperationFailed(
                "injected write failure".to_string(),
            ));
        }
        if self
            .fail_puts_for_suffix
            .lock()
            .unwrap()
            .iter()
            .any(|suffix| key.ends_with(suffix.as_str()))
        {
            return Err(S3Error::OperationFailed(format!(
                "injected write failure for {key}"
            )));
        }
        Self::check_budget(&self.fail_puts_after, "write")?;
        self.objects.lock().unwrap().insert(
            key.to_string(),
            StoredObject {
                data,
                public,
                last_modified: Some(SystemTime::now()),
            },
        );
        Ok(())
    }

    async fn set_object_tagging(&self, key: &str, public: bool) -> Result<(), S3Error> {
        self.check_fail()?;
        match self.objects.lock().unwrap().get_mut(key) {
            Some(object) => {
                object.public = public;
                Ok(())
            }
            None => Err(S3Error::NotFound),
        }
    }

    async fn get_object_public(&self, key: &str) -> Result<bool, S3Error> {
        self.check_fail()?;
        self.objects
            .lock()
            .unwrap()
            .get(key)
            .map(|object| object.public)
            .ok_or(S3Error::NotFound)
    }

    async fn copy_object(&self, from: &str, to: &str) -> Result<(), S3Error> {
        self.check_fail()?;
        Self::check_budget(&self.fail_copies_after, "copy")?;
        let mut objects = self.objects.lock().unwrap();
        // Like a real server-side copy: the bytes and the `public=` tag come
        // along, but the copy is a fresh write, so it gets a fresh
        // last-modified (which is what keeps the GC's safety margin honest
        // about migrated objects).
        let mut copied = objects.get(from).cloned().ok_or(S3Error::NotFound)?;
        copied.last_modified = Some(SystemTime::now());
        objects.insert(to.to_string(), copied);
        Ok(())
    }

    async fn delete_object(&self, key: &str) -> Result<(), S3Error> {
        self.check_fail()?;
        Self::check_budget(&self.fail_deletes_after, "delete")?;
        self.objects.lock().unwrap().remove(key);
        Ok(())
    }

    async fn list_objects(&self, prefix: &str) -> Result<Vec<ObjectMeta>, S3Error> {
        self.check_fail()?;
        let mut listed: Vec<ObjectMeta> = self
            .objects
            .lock()
            .unwrap()
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .map(|(key, object)| ObjectMeta {
                key: key.clone(),
                last_modified: object.last_modified,
            })
            .collect();
        listed.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(listed)
    }
}

/// Build a real `AppState` (real JWKS cache, real health cache) around the
/// given in-memory store.
pub fn state_with_store(jwks: JwkSet, store: Arc<InMemoryStore>) -> AppState {
    AppState {
        jwks: Arc::new(JwksCache::new(
            jwks,
            "http://127.0.0.1:1/jwks.json".to_string(),
        )),
        s3_service: store,
        health: Arc::new(HealthCache::default()),
    }
}
