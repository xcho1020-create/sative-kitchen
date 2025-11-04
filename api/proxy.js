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
    
    const url = new URL(GOOGLE_API);
    url.searchParams.append('action', action);
    
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
