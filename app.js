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

const TBILISI_TIMEZONE = 'Asia/Tbilisi';
const tbilisiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TBILISI_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function parseTbilisiDate(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00+04:00`);
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return parseTbilisiDate(numeric);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function normalizeDeliveryDate(value) {
  const parsed = parseTbilisiDate(value);
  if (!parsed) return '';
  return tbilisiDateFormatter.format(parsed);
}

function formatDate(value) {
  const normalized = normalizeDeliveryDate(value);
  return normalized || 'No date';
}

function normalizePaymentStatus(value) {
  if (value === null || value === undefined) {
    return 'unpaid';
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === 'paid' ? 'paid' : 'unpaid';
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
  
  const deliveries = (result.data || []).map(delivery => ({
    ...delivery,
    date: normalizeDeliveryDate(delivery.date),
    payment_status: normalizePaymentStatus(delivery.payment_status)
  }));

  const html = deliveries.map(d => {
    const isPaymentPaid = d.payment_status === 'paid';
    const paymentStatusLabel = isPaymentPaid ? 'paid' : 'unpaid';
    const canChangePayment = ['executor', 'manager', 'mom'].includes(currentRole);

    return `
    <div class="delivery-card">
      <div class="delivery-date">${formatDate(d.date)}</div>
      <div class="delivery-totals">
        <span>cost: ${d.total_cost.toFixed(2)}₾</span>
        <span>sale: ${d.total_sell.toFixed(2)}₾</span>
      </div>
      <div class="delivery-margin">margin: ${d.margin.toFixed(2)}₾</div>
      <div class="delivery-payment">
        <span class="payment-status ${isPaymentPaid ? 'paid' : 'unpaid'}">payment: ${paymentStatusLabel}</span>
        ${canChangePayment ? `
          <div class="payment-actions">
            <button onclick="markDeliveryPaid(${d.id})" ${isPaymentPaid ? 'disabled' : ''}>mark as paid</button>
            <button onclick="markDeliveryUnpaid(${d.id})" ${!isPaymentPaid ? 'disabled' : ''}>mark as unpaid</button>
          </div>
        ` : ''}
      </div>
      ${currentRole === 'mom' ? `<button onclick="editDelivery(${d.id})">edit</button>` : ''}
    </div>
  `;
  }).join('');

  document.getElementById('deliveriesList').innerHTML = html || '<p>no deliveries</p>';
}

async function markDeliveryPaid(id) {
  const result = await apiCall('markDeliveryPaid', { id }, 'POST');

  if (result.success) {
    await loadDeliveries();
  } else {
    alert('error: ' + (result.error || 'unknown'));
  }
}

async function markDeliveryUnpaid(id) {
  const result = await apiCall('markDeliveryUnpaid', { id }, 'POST');

  if (result.success) {
    await loadDeliveries();
  } else {
    alert('error: ' + (result.error || 'unknown'));
  }
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
  const dateInput = document.getElementById('deliveryDate');
  const date = normalizeDeliveryDate(dateInput ? dateInput.value : '');

  if (!date) {
    alert('select delivery date');
    return;
  }
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
  
  const result = await apiCall('createDelivery', { date, items, created_by: currentUser, payment_status: 'unpaid' }, 'POST');
  
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
