use axum::{extract::FromRequestParts, http::request::Parts};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    ReadOnly,
    Editor,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub subject: String,
    pub role: Role,
}

#[derive(Clone, Debug)]
pub struct AuthConfig {
    issuer: Option<String>,
    audience: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    realm_access: Option<RealmAccess>,
    resource_access: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RealmAccess {
    roles: Vec<String>,
}

impl AuthConfig {
    pub fn from_env() -> Self {
        Self {
            issuer: std::env::var("KEYCLOAK_ISSUER").ok(),
            audience: std::env::var("KEYCLOAK_AUDIENCE")
                .ok()
                .or_else(|| std::env::var("KEYCLOAK_CLIENT_ID").ok()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.issuer.is_some()
    }

    pub async fn principal_from_token(&self, token: &str) -> Result<Principal, AppError> {
        let Some(issuer) = &self.issuer else {
            return Ok(Principal {
                subject: "local-dev".to_string(),
                role: Role::Editor,
            });
        };

        let header = decode_header(token).map_err(|_| AppError::Unauthorized)?;
        let kid = header.kid.ok_or(AppError::Unauthorized)?;
        let jwks_url = format!("{issuer}/protocol/openid-connect/certs");
        let jwks = reqwest::get(jwks_url)
            .await
            .map_err(|_| AppError::Unauthorized)?
            .json::<JwkSet>()
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let jwk = jwks.find(&kid).ok_or(AppError::Unauthorized)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| AppError::Unauthorized)?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        if let Some(audience) = &self.audience {
            validation.set_audience(&[audience]);
        } else {
            validation.validate_aud = false;
        }

        let data =
            decode::<Claims>(token, &key, &validation).map_err(|_| AppError::Unauthorized)?;
        let role = role_from_claims(&data.claims);
        Ok(Principal {
            subject: data.claims.sub,
            role,
        })
    }
}

impl Principal {
    pub fn can_edit(&self) -> bool {
        self.role == Role::Editor
    }
}

impl<S> FromRequestParts<S> for Principal
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        if let Some(principal) = parts.extensions.get::<Principal>() {
            return Ok(principal.clone());
        }
        Err(AppError::Unauthorized)
    }
}

fn role_from_claims(claims: &Claims) -> Role {
    let mut roles = claims
        .realm_access
        .as_ref()
        .map(|access| access.roles.clone())
        .unwrap_or_default();

    if let Some(resource_access) = &claims.resource_access {
        collect_resource_roles(resource_access, &mut roles);
    }

    if roles
        .iter()
        .any(|role| role == "editor" || role == "dbml-editor")
    {
        Role::Editor
    } else {
        Role::ReadOnly
    }
}

fn collect_resource_roles(value: &serde_json::Value, output: &mut Vec<String>) {
    let Some(resources) = value.as_object() else {
        return;
    };
    for resource in resources.values() {
        if let Some(roles) = resource.get("roles").and_then(|roles| roles.as_array()) {
            output.extend(
                roles
                    .iter()
                    .filter_map(|role| role.as_str().map(ToString::to_string)),
            );
        }
    }
}
