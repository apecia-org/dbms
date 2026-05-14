use axum::{
    Json, Router,
    extract::{Path, Request, State},
    http::header,
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use uuid::Uuid;

use crate::{
    auth::{AuthConfig, Principal},
    db::{Store, UpsertDocument},
    error::AppError,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub auth: AuthConfig,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/session", get(session))
        .route("/documents", get(list_documents).post(create_document))
        .route(
            "/documents/{id}",
            get(get_document)
                .put(update_document)
                .delete(delete_document),
        )
        .route("/documents/{id}/versions", get(list_document_versions))
        .route(
            "/documents/{id}/versions/{version_number}",
            get(get_document_version),
        )
        .layer(middleware::from_fn_with_state((), inject_principal))
}

async fn health() -> &'static str {
    "ok"
}

async fn session(principal: Principal) -> Json<Principal> {
    Json(principal)
}

async fn list_documents(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::db::Document>>, AppError> {
    Ok(Json(state.store.list_documents().await?))
}

async fn get_document(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<crate::db::Document>, AppError> {
    Ok(Json(state.store.get_document(id).await?))
}

async fn create_document(
    State(state): State<AppState>,
    principal: Principal,
    Json(input): Json<UpsertDocument>,
) -> Result<Json<crate::db::Document>, AppError> {
    require_editor(&principal)?;
    Ok(Json(
        state
            .store
            .create_document(input, &principal.subject)
            .await?,
    ))
}

async fn update_document(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<Uuid>,
    Json(input): Json<UpsertDocument>,
) -> Result<Json<crate::db::Document>, AppError> {
    require_editor(&principal)?;
    Ok(Json(state.store.update_document(id, input).await?))
}

async fn delete_document(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    require_editor(&principal)?;
    state.store.delete_document(id).await
}

async fn list_document_versions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<crate::db::DocumentVersionSummary>>, AppError> {
    Ok(Json(state.store.list_document_versions(id).await?))
}

async fn get_document_version(
    State(state): State<AppState>,
    Path((id, version_number)): Path<(Uuid, i64)>,
) -> Result<Json<crate::db::DocumentVersion>, AppError> {
    Ok(Json(
        state.store.get_document_version(id, version_number).await?,
    ))
}

async fn inject_principal(mut request: Request, next: Next) -> Result<Response, AppError> {
    let state = request.extensions().get::<AppState>().cloned();
    let auth = state
        .map(|state| state.auth)
        .unwrap_or_else(AuthConfig::from_env);

    let principal = if auth.is_enabled() {
        let token = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;
        auth.principal_from_token(token).await?
    } else {
        auth.principal_from_token("").await?
    };

    request.extensions_mut().insert(principal);
    Ok(next.run(request).await)
}

fn require_editor(principal: &Principal) -> Result<(), AppError> {
    if principal.can_edit() {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
