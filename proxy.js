export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const GOOGLE_API = 'https://script.google.com/macros/s/AKfycbw8qyk5QShIHCi2dm3sHZcAQizNH2QGEAvkKI6lYO2ZNb0f3NZUaLTlQxjfyVzGRHMbqg/exec';
  
  try {
    const { action, data } = req.method === 'POST' ? req.body : { action: req.query.action };

    if (!action) {
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    const url = new URL(GOOGLE_API);
    url.searchParams.append('action', action);

    // Forward any additional query parameters (e.g. delivery id) to the Google Apps Script
    if (req.method === 'GET' && req.query) {
      Object.entries(req.query).forEach(([key, value]) => {
        if (key === 'action') return;

        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, v));
        } else if (value !== undefined) {
          url.searchParams.append(key, value);
        }
      });
    }

    const options = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (req.method === 'POST' && data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url.toString(), options);
    const result = await response.json();
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
