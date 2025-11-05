// app logic
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
    console.error('api error:', error);
    return { error: error.message };
  }
}

// auth functions
function login(role, password) {
  if (AUTH[role] === password) {
    currentUser = role;
    currentRole = role;
    localStorage.setItem('user', role);
    localStorage.setItem('lastRole', role); // NEW: remember last role
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
    return saved;
  }
  return null;
}

// NEW: auto-fill last role on login page
function loadLastRole() {
  const lastRole = localStorage.getItem('lastRole');
  if (lastRole) {
    const roleSelect = document.getElementById('roleSelect');
    if (roleSelect) {
      roleSelect.value = lastRole;
    }
  }
}

// page navigation
function showPage(page) {
  document.querySelectorAll('[data-page]').forEach(el => el.style.display = 'none');
  const target = document.querySelector(`[data-page="${page}"]`);
  if (target) {
    target.style.display = 'block';

    if (page === 'home' || page === 'manager') {
      loadDeliveries();
    }
    if (page === 'admin') {
      loadAdminOverview();
    }
    if (page === 'admin-products') {
      loadAdminProducts();
    }
    if (page === 'admin-log') {
      loadAuditLog();
    }
  }
}

// load deliveries with margin visibility control
async function loadDeliveries() {
  const result = await apiCall('getDeliveries');

  if (result.error) {
    document.getElementById('deliveriesList').innerHTML = '<p>error loading deliveries</p>';
    return;
  }

  const showMargin = currentRole !== 'manager'; // NEW: hide margin from manager
  const showCost = currentRole !== 'manager'; // NEW: hide cost from manager

  let html = '';
  if (result.data && result.data.length > 0) {
    result.data.forEach(d => {
      const totalCost = d.items ? d.items.reduce((sum, item) => sum + (item.cost * item.quantity), 0) : 0;
      const totalSell = d.items ? d.items.reduce((sum, item) => sum + (item.sell * item.quantity), 0) : 0;
      const margin = totalSell - totalCost;
      const itemCount = d.items ? d.items.length : 0; // NEW: show item count

      html += `
        <div class="card" onclick="viewDelivery(${d.id})" style="cursor: pointer;">
          <h3>${d.name}</h3>
          <p>date: ${d.date}</p>
          <p>items: ${itemCount}</p>
          ${showCost ? `<p>cost: ${totalCost.toFixed(2)} ₽</p>` : ''}
          <p>sell: ${totalSell.toFixed(2)} ₽</p>
          ${showMargin ? `<p>margin: ${margin.toFixed(2)} ₽</p>` : ''}
          <p class="status-badge">${d.status || 'draft'}</p>
        </div>
      `;
    });
  } else {
    html = '<p>no deliveries yet</p>';
  }

  document.getElementById('deliveriesList').innerHTML = html;
}

// NEW: view delivery with comments
async function viewDelivery(id) {
  const result = await apiCall('getDelivery', { id: id }, 'POST');

  if (result.error) {
    alert('error loading delivery');
    return;
  }

  const delivery = result.data;
  const showMargin = currentRole !== 'manager';
  const showCost = currentRole !== 'manager';

  let detailHtml = `
    <h2>${delivery.name}</h2>
    <p>date: ${delivery.date}</p>
    <p>status: ${delivery.status || 'draft'}</p>
    <h3>items:</h3>
    <table>
      <thead>
        <tr>
          <th>product</th>
          <th>quantity</th>
          ${showCost ? '<th>cost</th>' : ''}
          <th>sell</th>
          ${showMargin ? '<th>margin</th>' : ''}
        </tr>
      </thead>
      <tbody>
  `;

  if (delivery.items) {
    delivery.items.forEach(item => {
      const itemMargin = (item.sell - item.cost) * item.quantity;
      detailHtml += `
        <tr>
          <td>${item.productName}</td>
          <td>${item.quantity}</td>
          ${showCost ? `<td>${item.cost.toFixed(2)} ₽</td>` : ''}
          <td>${item.sell.toFixed(2)} ₽</td>
          ${showMargin ? `<td>${itemMargin.toFixed(2)} ₽</td>` : ''}
        </tr>
      `;
    });
  }

  detailHtml += `</tbody></table>`;

  // NEW: comments section
  detailHtml += `<h3>comments:</h3><div id="commentsList">`;
  if (delivery.comments && delivery.comments.length > 0) {
    delivery.comments.forEach(c => {
      detailHtml += `<div class="comment-box"><strong>${c.author}:</strong> ${c.text} <small>(${c.date})</small></div>`;
    });
  } else {
    detailHtml += `<p>no comments yet</p>`;
  }
  detailHtml += `</div>
    <textarea id="newComment" placeholder="add comment..." rows="3"></textarea>
    <button onclick="addComment(${id})">add comment</button>
    <button onclick="showPage('${currentRole === 'admin' ? 'admin' : 'home'}')">back</button>
  `;

  document.getElementById('deliveryDetailContent').innerHTML = detailHtml;
  showPage('delivery-detail');
}

// NEW: add comment to delivery
async function addComment(deliveryId) {
  const text = document.getElementById('newComment').value.trim();
  if (!text) {
    alert('enter comment text');
    return;
  }

  const result = await apiCall('addComment', {
    deliveryId: deliveryId,
    text: text,
    author: currentRole
  }, 'POST');

  if (result.success) {
    viewDelivery(deliveryId); // reload
  } else {
    alert('error adding comment');
  }
}

// load admin products with active/inactive status
async function loadAdminProducts() {
  const result = await apiCall('getProducts');

  if (result.error) {
    document.getElementById('productsList').innerHTML = '<p>error loading products</p>';
    return;
  }

  const activeProducts = result.data.filter(p => p.status !== 'inactive');
  const inactiveProducts = result.data.filter(p => p.status === 'inactive');

  let html = '<h3>active products</h3><table><thead><tr><th>name</th><th>quantity</th>';

  if (currentRole !== 'manager') {
    html += '<th>cost</th>';
  }

  html += '<th>sell</th><th>actions</th></tr></thead><tbody>';

  activeProducts.forEach(p => {
    html += `
      <tr>
        <td>${p.name}</td>
        <td>${p.quantity || 0}</td>
        ${currentRole !== 'manager' ? `<td><input type="number" value="${p.cost_price}" onchange="updateProduct(${p.id}, 'cost', this.value)" step="0.01" /></td>` : ''}
        <td><input type="number" value="${p.sell_price}" onchange="updateProduct(${p.id}, 'sell', this.value)" step="0.01" /></td>
        <td>
          <button onclick="toggleProductStatus(${p.id})">deactivate</button>
          <button onclick="viewPriceHistory(${p.id})">history</button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';

  // NEW: show inactive products
  if (inactiveProducts.length > 0) {
    html += '<h3>inactive products</h3><table><thead><tr><th>name</th><th>actions</th></tr></thead><tbody>';

    inactiveProducts.forEach(p => {
      html += `
        <tr>
          <td>${p.name}</td>
          <td><button onclick="toggleProductStatus(${p.id})">activate</button></td>
        </tr>
      `;
    });

    html += '</tbody></table>';
  }

  html += '<button onclick="showAddProductForm()">+ add product</button>';

  document.getElementById('productsList').innerHTML = html;
}

// NEW: toggle product active/inactive
async function toggleProductStatus(productId) {
  const result = await apiCall('toggleProductStatus', { productId: productId }, 'POST');

  if (result.success) {
    loadAdminProducts();
  } else {
    alert('error updating status');
  }
}

// NEW: view price history
async function viewPriceHistory(productId) {
  const result = await apiCall('getPriceHistory', { productId: productId }, 'POST');

  if (result.error || !result.data || result.data.length === 0) {
    alert('no price history available');
    return;
  }

  let html = '<h2>price change history</h2><table><thead><tr><th>date</th><th>old cost</th><th>new cost</th><th>changed by</th></tr></thead><tbody>';

  result.data.forEach(h => {
    html += `
      <tr>
        <td>${h.date}</td>
        <td>${h.oldCost.toFixed(2)} ₽</td>
        <td>${h.newCost.toFixed(2)} ₽</td>
        <td>${h.changedBy}</td>
      </tr>
    `;
  });

  html += '</tbody></table><button onclick="loadAdminProducts()">back</button>';

  document.getElementById('productsList').innerHTML = html;
}

// NEW: show add product form
function showAddProductForm() {
  const html = `
    <h2>add new product</h2>
    <label>name: <input type="text" id="newProductName" /></label><br>
    <label>cost: <input type="number" id="newProductCost" step="0.01" /></label><br>
    <label>sell: <input type="number" id="newProductSell" step="0.01" /></label><br>
    <label>status: 
      <select id="newProductStatus">
        <option value="active">active</option>
        <option value="inactive">inactive</option>
      </select>
    </label><br>
    <button onclick="addProduct()">save</button>
    <button onclick="loadAdminProducts()">cancel</button>
  `;

  document.getElementById('productsList').innerHTML = html;
}

// NEW: add product
async function addProduct() {
  const name = document.getElementById('newProductName').value.trim();
  const cost = document.getElementById('newProductCost').value;
  const sell = document.getElementById('newProductSell').value;
  const status = document.getElementById('newProductStatus').value;

  if (!name || !cost || !sell) {
    alert('fill all fields');
    return;
  }

  const result = await apiCall('addProduct', {
    name: name,
    cost_price: parseFloat(cost),
    sell_price: parseFloat(sell),
    status: status,
    createdBy: currentRole
  }, 'POST');

  if (result.success) {
    loadAdminProducts();
  } else {
    alert('error adding product');
  }
}

// create delivery
async function createDelivery(data) {
  const result = await apiCall('addDelivery', data, 'POST');

  if (result.success) {
    alert('delivery created');
    showPage(currentRole === 'admin' ? 'admin' : 'home');
  } else {
    alert('error creating delivery');
  }
}

// edit delivery (kept from original)
async function editDelivery(id) {
  viewDelivery(id);
}

// update product (with price history tracking)
async function updateProduct(id, type, value) {
  const result = await apiCall('getProducts');
  const product = result.data.find(p => p.id === id);

  if (product) {
    const oldCost = product.cost_price;

    if (type === 'cost') product.cost_price = parseFloat(value);
    if (type === 'sell') product.sell_price = parseFloat(value);

    // NEW: track price history
    if (type === 'cost' && oldCost !== parseFloat(value)) {
      await apiCall('logPriceChange', {
        productId: id,
        oldCost: oldCost,
        newCost: parseFloat(value),
        changedBy: currentRole
      }, 'POST');
    }

    await apiCall('updateProduct', product, 'POST');
    loadAdminProducts();
  }
}

// NEW: load admin overview
async function loadAdminOverview() {
  // placeholder for admin dashboard
}

// NEW: load audit log
async function loadAuditLog() {
  const result = await apiCall('getAuditLog');

  if (result.error) {
    document.getElementById('auditLogList').innerHTML = '<p>error loading log</p>';
    return;
  }

  let html = '<table><thead><tr><th>date</th><th>user</th><th>action</th><th>details</th></tr></thead><tbody>';

  if (result.data && result.data.length > 0) {
    result.data.forEach(log => {
      html += `
        <tr>
          <td>${log.date}</td>
          <td>${log.user}</td>
          <td>${log.action}</td>
          <td>${log.details}</td>
        </tr>
      `;
    });
  } else {
    html = '<p>no log entries</p>';
  }

  html += '</tbody></table>';
  document.getElementById('auditLogList').innerHTML = html;
}

// NEW: analytics
async function loadAnalytics(dateFrom, dateTo) {
  const result = await apiCall('getAnalytics', { dateFrom, dateTo }, 'POST');

  if (result.error) {
    return;
  }

  const showMargin = currentRole !== 'manager';
  const data = result.data;

  let html = `
    <div class="analytics-grid">
      <div class="card">
        <h3>total deliveries</h3>
        <p class="big-number">${data.totalDeliveries}</p>
      </div>
      <div class="card">
        <h3>total revenue</h3>
        <p class="big-number">${data.totalRevenue.toFixed(2)} ₽</p>
      </div>
      ${showMargin ? `
      <div class="card">
        <h3>total margin</h3>
        <p class="big-number">${data.totalMargin.toFixed(2)} ₽</p>
      </div>
      ` : ''}
    </div>
  `;

  if (data.monthlyData && data.monthlyData.length > 0) {
    html += '<h3>monthly breakdown</h3><table><thead><tr><th>month</th><th>deliveries</th><th>revenue</th>';

    if (showMargin) {
      html += '<th>margin</th>';
    }

    html += '</tr></thead><tbody>';

    data.monthlyData.forEach(m => {
      html += `
        <tr>
          <td>${m.month}</td>
          <td>${m.count}</td>
          <td>${m.revenue.toFixed(2)} ₽</td>
          ${showMargin ? `<td>${m.margin.toFixed(2)} ₽</td>` : ''}
        </tr>
      `;
    });

    html += '</tbody></table>';
  }

  return html;
}

// initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  loadLastRole(); // NEW: auto-fill last role

  if (checkAuth()) {
    currentUser = checkAuth();
    currentRole = checkAuth();
    showPage(currentRole === 'admin' ? 'admin' : currentRole === 'manager' ? 'manager' : 'home');
  } else {
    showPage('login');
  }
});
