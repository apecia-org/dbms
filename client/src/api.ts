import type { DocumentVersion, DocumentVersionSummary, SavedDocument } from './types';

const jsonHeaders = { 'Content-Type': 'application/json' };

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

export type Session = {
  subject: string;
  role: 'read-only' | 'editor';
};

export async function getSession(token?: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/session`, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function listDocuments(token?: string): Promise<SavedDocument[]> {
  const response = await fetch(`${API_BASE}/documents`, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function saveDocument(
  input: { id?: string; name: string; dbml: string; layoutJson: unknown; parsedSchema?: unknown | null; wikiMetadata?: unknown | null; note?: string | null },
  token?: string,
): Promise<SavedDocument> {
  const response = await fetch(input.id ? `${API_BASE}/documents/${input.id}` : `${API_BASE}/documents`, {
    method: input.id ? 'PUT' : 'POST',
    headers: { ...jsonHeaders, ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteDocument(id: string, token?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE', headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
}

export async function listDocumentVersions(id: string, token?: string): Promise<DocumentVersionSummary[]> {
  const response = await fetch(`${API_BASE}/documents/${id}/versions`, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getDocumentVersion(id: string, versionNumber: number, token?: string): Promise<DocumentVersion> {
  const response = await fetch(`${API_BASE}/documents/${id}/versions/${versionNumber}`, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
