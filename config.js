// API Configuration
const API_URL = 'https://script.google.com/macros/s/AKfycbw8qyk5QShIHCi2dm3sHZcAQizNH2QGEAvkKI6lYO2ZNb0f3NZUaLTlQxjfyVzGRHMbqg/exec';

// Auth credentials (change these)
const AUTH = {
  mom: '1234',
  manager: '5678',
  admin: '9999'
};

// Current user session
let currentUser = null;
let currentRole = null;
