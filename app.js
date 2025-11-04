// App Logic
async function apiCall(action, data = null, method = 'GET') {
  const url = data ? `${API_URL}?action=${action}` : `${API_URL}?action=${action}`;
  
  const options = {
    method: method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (method === 'POST' && data) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

// Auth functions
function login(role, password) {
  if (AUTH[role] === password) {
    currentUser = role;
    currentRole = role;
    localStorage.setItem('user', role);
    showPage(role === 'admin' ? 'admin' : role === 'manager' ? 'manager' : 'home');
    return true;
  }
  alert('invalid password');
  return false;
}

function logout() {
  currentUser = null;
  currentRole = null;
  localStorage.removeItem('user');
  showPage('login');
}

function checkAuth() {
  const saved = localStorage.getItem('user');
  if (saved && AUTH[saved]) {
    currentUser = saved;
    currentRole = saved;
    return true;
  }
  return false;
}

// Page navigation
function showPage(page) {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.style.display = 'none';
  });
  
  const target = document.querySelector(`[data-page="${page}"]`);
  if (target) {
    target.style.display = 'block';
    
    if (page === 'home') loadDeliveries();
    if (page === 'admin') loadAdminProducts();
  }
}

// Load deliveries list
async function loadDeliveries() {
  const result = await apiCall('getDeliveries');
  
  if (!result.success) {
    document.getElementById('deliveriesList').innerHTML = '<p>error loading</p>';
    return;
  }
  
  const html = result.data.map(d => `
    <div class="delivery-card">
      <div class="delivery-date">${d.date}</div>
      <div class="delivery-totals">
        <span>cost: ${d.total_cost.toFixed(2)}₾</span>
        <span>sale: ${d.total_sell.toFixed(2)}₾</span>
      </div>
      <div class="delivery-margin">margin: ${d.margin.toFixed(2)}₾</div>
      ${currentRole === 'mom' ? `<button onclick="editDelivery(${d.id})">edit</button>` : ''}
    </div>
  `).join('');
  
  document.getElementById('deliveriesList').innerHTML = html || '<p>no deliveries</p>';
}

// Load admin products
async function loadAdminProducts() {
  const result = await apiCall('getProducts');
  
  if (!result.success) {
    document.getElementById('productsList').innerHTML = '<p>error</p>';
    return;
  }
  
  const html = result.data.map(p => `
    <div class="product-row">
      <div class="product-name">${p.name}</div>
      <div class="product-prices">
        <input type="number" value="${p.cost_price}" placeholder="cost" class="price-input" onchange="updateProduct(${p.id}, this.value, 'cost')">
        <input type="number" value="${p.sell_price}" placeholder="sell" class="price-input" onchange="updateProduct(${p.id}, this.value, 'sell')">
      </div>
    </div>
  `).join('');
  
  document.getElementById('productsList').innerHTML = html;
}

// Create new delivery
async function createDelivery() {
  const date = document.getElementById('deliveryDate').value;
  const items = [];
  
  document.querySelectorAll('.delivery-item-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
    if (qty > 0) {
      items.push({
        product_id: parseInt(row.dataset.productId),
        quantity: qty,
        cost_price: parseFloat(row.querySelector('.cost-price').textContent),
        sell_price: parseFloat(row.querySelector('.sell-price').textContent)
      });
    }
  });
  
  const result = await apiCall('createDelivery', { date, items, created_by: currentUser }, 'POST');
  
  if (result.success) {
    alert('delivery created');
    showPage('home');
  } else {
    alert('error: ' + result.error);
  }
}

// Edit delivery
async function editDelivery(id) {
  const result = await apiCall('getDelivery', null, 'GET');
  result.id = id;
  
  if (result.success) {
    // Show edit form
    showDeliveryForm(result.data);
  }
}

// Update product prices
async function updateProduct(id, value, type) {
  // Get current product
  const result = await apiCall('getProducts');
  const product = result.data.find(p => p.id === id);
  
  if (product) {
    if (type === 'cost') product.cost_price = parseFloat(value);
    if (type === 'sell') product.sell_price = parseFloat(value);
    
    await apiCall('updateProduct', product, 'POST');
    loadAdminProducts();
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (checkAuth()) {
    showPage(currentRole === 'admin' ? 'admin' : 'home');
  } else {
    showPage('login');
  }
});
