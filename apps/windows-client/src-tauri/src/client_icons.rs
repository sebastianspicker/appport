use super::*;

impl RelutionClient {
    pub async fn icon(
        &self,
        t: &str,
        u: &str,
        app: &str,
        generation: u64,
    ) -> Result<Option<String>, String> {
        if let Some(icon) = self.cached_icon(generation, app)? {
            return Ok(icon);
        }
        self.load_uncached_icon(t, u, app, generation).await
    }

    async fn load_uncached_icon(
        &self,
        t: &str,
        u: &str,
        app: &str,
        generation: u64,
    ) -> Result<Option<String>, String> {
        let _permit = self.icon_permit().await?;
        if let Some(icon) = self.cached_icon(generation, app)? {
            return Ok(icon);
        }
        self.require_permitted_app(t, u, app, generation).await?;
        let icon = self.fetch_icon(t, app).await?;
        self.cache_for(generation)?
            .icons
            .insert(app.into(), icon.clone());
        Ok(icon)
    }

    async fn icon_permit(&self) -> Result<tokio::sync::SemaphorePermit<'_>, String> {
        self.icon_requests
            .acquire()
            .await
            .map_err(|_| "unknown: icon request limit is unavailable".into())
    }

    fn cached_icon(&self, generation: u64, app: &str) -> Result<Option<Option<String>>, String> {
        Ok(self.cache_for(generation)?.icons.get(app).cloned())
    }
    async fn require_permitted_app(
        &self,
        token: &str,
        user: &str,
        app: &str,
        generation: u64,
    ) -> Result<(), String> {
        let cached_apps = { self.cache_for(generation)?.apps.clone() };
        let apps = match cached_apps {
            Some(apps) => apps,
            None => {
                let device = self.current_device(token, user).await?;
                self.cached_apps(token, user, &device, generation).await?
            }
        };
        if apps.iter().any(|candidate| candidate.id == app) {
            Ok(())
        } else {
            Err("server: application is not permitted".into())
        }
    }

    pub(super) async fn fetch_icon(&self, t: &str, app: &str) -> Result<Option<String>, String> {
        let path = format!("/api/management/v1/content/apps/{}/icon", encode(app));
        let r = self
            .http
            .get(self.url(&path)?)
            .header("X-User-Access-Token", t)
            .header("tenantOrganizationUuid", &self.config.organization_uuid)
            .send()
            .await
            .map_err(network)?;
        let content_type = r
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        crate::logging::write_relution_icon_response(
            &path,
            r.status().as_u16(),
            content_type,
            r.content_length(),
        );
        icon_data_url(r).await
    }

    pub(super) fn cache_for(
        &self,
        generation: u64,
    ) -> Result<std::sync::MutexGuard<'_, CredentialCache>, String> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "unknown: native cache is unavailable")?;
        if cache.generation != Some(generation) {
            *cache = CredentialCache {
                generation: Some(generation),
                ..CredentialCache::default()
            };
        }
        Ok(cache)
    }
}
