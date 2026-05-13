import type { SavedDocument } from './types';

const jsonHeaders = { 'Content-Type': 'application/json' };

export type Session = {
  subject: string;
  role: 'read-only' | 'editor';
};

export async function getSession(token?: string): Promise<Session> {
  const response = await fetch('/api/session', { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function listDocuments(token?: string): Promise<SavedDocument[]> {
  const response = await fetch('/api/documents', { headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function saveDocument(input: { id?: string; name: string; dbml: string; layoutJson: unknown }, token?: string): Promise<SavedDocument> {
  const response = await fetch(input.id ? `/api/documents/${input.id}` : '/api/documents', {
    method: input.id ? 'PUT' : 'POST',
    headers: { ...jsonHeaders, ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteDocument(id: string, token?: string): Promise<void> {
  const response = await fetch(`/api/documents/${id}`, { method: 'DELETE', headers: authHeaders(token) });
  if (!response.ok) throw new Error(await response.text());
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
