// Thin axios wrapper for backend communication.
// For now this file only exists as a placeholder; the UI is wired
// to mock data so that it can be developed independently of the
// backend server being online.

import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000',
  withCredentials: false
});

