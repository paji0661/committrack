// --- CONFIGURATION ---
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwht-Es9Z8eivt5ecjDwAp34O4T2bTHITEEng3pL-2i7pX7zzJSINmIdkVCAWNvP4Z3/exec';

// --- STATE ---
let currentUser = localStorage.getItem('familyTrackerUserEmail') || null;
let currentDisplayName = localStorage.getItem('familyTrackerDisplayName') || '';

let allCommitments = [];
const recentDescriptionsSet = new Set();
let overviewChartInstance = null;
let currentViewMode = 'ACTIVE'; // 'ACTIVE' or 'ARCHIVED'

// --- DOM ELEMENTS ---
const loadingOverlay = document.getElementById('loading-overlay');
const loginContainer = document.getElementById('login-container');
const loginError = document.getElementById('login-error');
const registerContainer = document.getElementById('register-container');
const registerEmailDisplay = document.getElementById('register-email-display');
const registerForm = document.getElementById('register-form');
const registerNameInput = document.getElementById('register-name-input');
const registerBtn = document.getElementById('register-btn');

const appContainer = document.getElementById('app-container');
const headerEmailDisplay = document.getElementById('header-email-display');
const logoutBtn = document.getElementById('logout-btn');

// View Toggles
const viewArchivesBtn = document.getElementById('view-archives-btn');
const viewActiveBtn = document.getElementById('view-active-btn');
const shareLedgerBtn = document.getElementById('share-ledger-btn');
const checklistTitle = document.getElementById('checklist-title');

// Batch Actions
let selectedForBatch = [];
const batchActionBar = document.getElementById('batch-action-bar');
const batchCountDisplay = document.getElementById('batch-count-display');
const batchUpdateBtn = document.getElementById('batch-update-btn');

// Main Content
const analyticsSection = document.getElementById('analytics-section');
const commitmentsWrapper = document.getElementById('commitments-wrapper');
const commitmentsEmptyState = document.getElementById('commitments-empty-state');
const emptyStateTitle = document.getElementById('empty-state-title');
const emptyStateDesc = document.getElementById('empty-state-desc');
const showAddCommitmentBtn = document.getElementById('show-add-commitment-btn');

// Modals
const shareLedgerModal = document.getElementById('share-ledger-modal');
const closeShareModalBtn = document.getElementById('close-share-modal-btn');
const shareLedgerForm = document.getElementById('share-ledger-form');
const shareEmailInput = document.getElementById('share-email-input');
const shareMonthInput = document.getElementById('share-month-input');

const commitmentModal = document.getElementById('commitment-modal');
const closeCommitmentModalBtn = document.getElementById('close-commitment-modal-btn');
const commitmentForm = document.getElementById('commitment-form');
const entryIdInput = document.getElementById('entry-id');
const entryFolderIdInput = document.getElementById('entry-folder-id');
const entryNameInput = document.getElementById('entry-name');
const entryAmountInput = document.getElementById('entry-amount');
const entryDueInput = document.getElementById('entry-due');
const entryStatusInput = document.getElementById('entry-status');
const editOnlyGroup = document.querySelector('.edit-only');
const modalTitle = document.getElementById('modal-title');
const recentDescriptionsList = document.getElementById('recent-descriptions-list');


// --- GOOGLE SIGN-IN ---
function handleCredentialResponse(response) {
    showLoading();
    loginError.classList.add('hidden');
    registerContainer.classList.add('hidden');

    let base64Url = response.credential.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));

    const token = JSON.parse(jsonPayload);
    currentUser = token.email;

    verifyUserRole(currentUser);
}

window.addEventListener('DOMContentLoaded', () => {
    if (currentUser) {
        showLoading();
        verifyUserRole(currentUser);
    }
});

// --- API LAYER ---
async function apiRequest(action, payload = {}) {
    if (!APPS_SCRIPT_URL) return { status: 'error', message: 'URL not configured' };
    try {
        const urlWithParams = APPS_SCRIPT_URL + "?action=" + encodeURIComponent(action);
        const response = await fetch(urlWithParams, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: action, email: currentUser, payload: payload })
        });
        return await response.json();
    } catch (err) {
        return { status: 'error', message: 'Network error or CORS issue.' };
    }
}

// --- CORE LOGIC ---
async function verifyUserRole(email) {
    const res = await apiRequest('verifyRole', {});
    if (res.status === 'success') {
        currentDisplayName = res.displayName || email.split('@')[0];
        localStorage.setItem('familyTrackerUserEmail', email);
        localStorage.setItem('familyTrackerDisplayName', currentDisplayName);
        initApp();
    } else {
        localStorage.removeItem('familyTrackerUserEmail');
        localStorage.removeItem('familyTrackerDisplayName');

        // BUG FIX: We must KEEP currentUser populated so they can register
        currentUser = email;

        hideLoading();
        registerEmailDisplay.textContent = email;
        registerContainer.classList.remove('hidden');
        document.querySelector('.g_id_signin').classList.add('hidden');
    }
}

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) {
        alert("Session lost. Please try logging in again.");
        return;
    }

    showLoading();
    registerBtn.disabled = true;

    const dName = registerNameInput.value.trim();
    const res = await apiRequest('registerUser', { displayName: dName });

    if (res.status === 'success') {
        alert("Registration Successful!");
        // Now that they are in the database, re-verify them
        await verifyUserRole(currentUser);
    } else {
        alert("Error: " + res.message);
    }

    hideLoading();
    registerBtn.disabled = false;
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('familyTrackerUserEmail');
    localStorage.removeItem('familyTrackerDisplayName');
    window.location.reload();
});

// --- VIEW CONTROLLER ---
async function initApp() {
    loginContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    headerEmailDisplay.textContent = currentDisplayName;

    await fetchData();
}

async function fetchData() {
    showLoading();
    const res = await apiRequest('getChecklist', {});
    hideLoading();

    if (res.status === 'success') {
        allCommitments = res.data;
        updateRecentDescriptions();
        renderChecklist();
    } else {
        alert('Error loading checklist: ' + res.message);
    }
}

// Toggles
viewArchivesBtn.addEventListener('click', () => {
    currentViewMode = 'ARCHIVED';
    viewArchivesBtn.classList.add('hidden');
    viewActiveBtn.classList.remove('hidden');
    checklistTitle.textContent = "Completed Archives";
    analyticsSection.classList.add('hidden');
    showAddCommitmentBtn.classList.add('hidden');
    shareLedgerBtn.classList.add('hidden');
    renderChecklist();
});

viewActiveBtn.addEventListener('click', () => {
    currentViewMode = 'ACTIVE';
    viewActiveBtn.classList.add('hidden');
    viewArchivesBtn.classList.remove('hidden');
    checklistTitle.textContent = "Active Commitments";
    analyticsSection.classList.remove('hidden');
    showAddCommitmentBtn.classList.remove('hidden');
    shareLedgerBtn.classList.remove('hidden');
    renderChecklist();
});


// --- RENDERING CHECKLIST ---
function renderChecklist() {
    commitmentsWrapper.innerHTML = '';

    let filtered = [];
    if (currentViewMode === 'ACTIVE') {
        filtered = allCommitments.filter(c => c.status !== 'Archived');
        renderAnalytics(filtered);
    } else {
        filtered = allCommitments.filter(c => c.status === 'Archived');
    }

    if (filtered.length === 0) {
        commitmentsWrapper.classList.add('hidden');
        commitmentsEmptyState.classList.remove('hidden');
        if (currentViewMode === 'ACTIVE') {
            emptyStateTitle.textContent = "No Active Items";
            emptyStateDesc.textContent = "You're all caught up! Click '+ Add Item' to create a new monthly commitment.";
        } else {
            emptyStateTitle.textContent = "No Archives";
            emptyStateDesc.textContent = "You haven't archived any paid items yet.";
        }
        return;
    }

    commitmentsWrapper.classList.remove('hidden');
    commitmentsEmptyState.classList.add('hidden');

    // Group by Month Year
    const grouped = {};
    filtered.forEach(item => {
        let dateObj = new Date(item.dueDate);
        if (isNaN(dateObj)) dateObj = new Date();
        const monthYear = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

        if (!grouped[monthYear]) {
            grouped[monthYear] = {
                label: monthYear,
                sortDate: new Date(dateObj.getFullYear(), dateObj.getMonth(), 1),
                items: []
            };
        }
        grouped[monthYear].items.push(item);
    });

    // Sort groups chronologically
    const sortedGroups = Object.values(grouped).sort((a, b) => {
        // Active view: oldest first (Ascending). Archives view: newest first (Descending)
        if (currentViewMode === 'ACTIVE') {
            return a.sortDate - b.sortDate;
        } else {
            return b.sortDate - a.sortDate;
        }
    });

    sortedGroups.forEach(groupDesc => {
        const monthKey = groupDesc.label;
        const sortedItems = groupDesc.items.sort((a, b) => {
            // Unchanged: items inside the month are still oldest first
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

        // Build table for this month block
        const monthSection = document.createElement('div');
        monthSection.style.marginBottom = '2.5rem';

        monthSection.innerHTML = `
            <h3 style="margin-bottom: 1rem; color: var(--primary-light); font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">${monthKey}</h3>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Ledger</th>
                            <th>Amount</th>
                            <th>Due Date</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        `;

        const tbody = monthSection.querySelector('tbody');

        sortedItems.forEach(item => {
            const tr = document.createElement('tr');

            let statusClass = 'status-pending';
            if (item.status === 'Paid') statusClass = 'status-paid';
            if (item.status === 'Archived') statusClass = 'status-archived'; // Add a subtle gray style if you want

            let actionsHtml = '';
            let nameColHtml = `<strong>${item.name}</strong>`;

            if (currentViewMode === 'ACTIVE') {
                if (item.status === 'Pending') {
                    const checkedState = selectedForBatch.find(u => u.id === item.id) ? 'checked' : '';
                    // Place checkbox in Actions column instead of name column
                    actionsHtml += `<input type="checkbox" class="modern-checkbox" onchange="toggleBatchSelection(this, '${item.id}', '${item.folderId}')" ${checkedState} style="margin-right: 0.5rem">`;
                } else if (item.status === 'Paid') {
                    actionsHtml += `<button class="btn btn-sm" style="background:var(--border); color:var(--text-main)" onclick="markCustomStatus('${item.id}', '${item.folderId}', 'Archived')" title="Archive">📦</button>`;
                }
                actionsHtml += `
                    <button class="btn btn-sm btn-outline" onclick="openEditCommitmentModal('${item.id}', '${item.folderId}')" title="Edit">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCommitmentEntry('${item.id}', '${item.folderId}')" title="Delete">🗑️</button>
                 `;
            } else {
                // Archived View Actions
                actionsHtml += `<button class="btn btn-sm btn-outline" onclick="markCustomStatus('${item.id}', '${item.folderId}', 'Paid')" title="Unarchive">↩️</button>`;
                actionsHtml += `<button class="btn btn-sm btn-danger" onclick="deleteCommitmentEntry('${item.id}', '${item.folderId}')" title="Delete">🗑️</button>`;
            }

            const amountFormatted = parseFloat(item.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

            tr.innerHTML = `
                <td>${nameColHtml}</td>
                <td><span style="font-size: 0.8rem; color: var(--text-muted)">${item.sourceLedger}</span></td>
                <td>${amountFormatted}</td>
                <td>${item.dueDate}</td>
                <td><span class="status-badge ${statusClass}">${item.status}</span></td>
                <td><div class="row-actions" style="gap: 0.5rem">${actionsHtml}</div></td>
            `;
            tbody.appendChild(tr);
        });

        commitmentsWrapper.appendChild(monthSection);
    });
}

function updateRecentDescriptions() {
    allCommitments.forEach(c => {
        if (c.name.trim()) recentDescriptionsSet.add(c.name.trim());
    });
    recentDescriptionsList.innerHTML = '';
    recentDescriptionsSet.forEach(desc => {
        const option = document.createElement('option');
        option.value = desc;
        recentDescriptionsList.appendChild(option);
    });
}

// --- BATCH LOGIC ---
window.toggleBatchSelection = function (checkboxEl, id, folderId) {
    if (checkboxEl.checked) {
        // Add to batch
        if (!selectedForBatch.find(u => u.id === id)) {
            selectedForBatch.push({ id, folderId, status: 'Paid' });
        }
    } else {
        // Remove from batch
        selectedForBatch = selectedForBatch.filter(u => u.id !== id);
    }
    updateBatchUI();
}

function updateBatchUI() {
    if (selectedForBatch.length > 0) {
        batchCountDisplay.textContent = `${selectedForBatch.length} Selected`;
        batchActionBar.classList.remove('hidden');
    } else {
        batchActionBar.classList.add('hidden');
    }
}

batchUpdateBtn.addEventListener('click', async () => {
    if (selectedForBatch.length === 0) return;

    showLoading();
    const payload = { updates: selectedForBatch };
    const res = await apiRequest('batchUpdateStatus', payload);

    if (res.status === 'success') {
        selectedForBatch = [];
        updateBatchUI();
        await fetchData(); // Refresh the list
    } else {
        alert("Batch error: " + res.message);
        hideLoading();
    }
});

// --- SINGLE ANALYTICS DOUGHNUT ---
function renderAnalytics(activeItems) {
    let pending = 0;
    let paid = 0;

    activeItems.forEach(i => {
        if (i.status === 'Paid') paid += parseFloat(i.amount);
        else pending += parseFloat(i.amount);
    });

    if (!overviewChartInstance) {
        const ctx = document.getElementById('overviewChart').getContext('2d');
        overviewChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'Paid'],
                datasets: [{
                    data: [0, 0],
                    backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(16, 185, 129, 0.8)'],
                    borderColor: ['#0f172a', '#0f172a'],
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter' } } }
                }
            }
        });
    }

    overviewChartInstance.data.datasets[0].data = [pending, paid];
    overviewChartInstance.update();
}

// --- ACTIONS & MODALS ---

shareLedgerBtn.addEventListener('click', () => {
    shareLedgerForm.reset();

    // Default the month picker to the current month to be helpful
    const now = new Date();
    const currentMonthVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    shareMonthInput.value = currentMonthVal;

    shareLedgerModal.classList.remove('hidden');
});
closeShareModalBtn.addEventListener('click', () => shareLedgerModal.classList.add('hidden'));

shareLedgerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = shareEmailInput.value.trim();

    // Convert YYYY-MM into "Month YYYY" string to match backend
    const [yearStr, monthNumStr] = shareMonthInput.value.split('-');
    const dateObj = new Date(parseInt(yearStr), parseInt(monthNumStr) - 1, 1);
    const targetMonthYear = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    shareLedgerModal.classList.add('hidden');
    showLoading();

    // Backend API now requires targetMonthYear
    const res = await apiRequest('shareFolder', { shareEmail: email, targetMonthYear: targetMonthYear });
    if (res.status === 'success') {
        alert(res.message);
    } else {
        alert('Error: ' + res.message);
    }

    hideLoading();
});


// Add / Edit
showAddCommitmentBtn.addEventListener('click', () => {
    modalTitle.textContent = "Add Item";
    commitmentForm.reset();
    entryIdInput.value = '';
    entryFolderIdInput.value = '';
    editOnlyGroup.classList.add('hidden');
    commitmentModal.classList.remove('hidden');
});

closeCommitmentModalBtn.addEventListener('click', () => commitmentModal.classList.add('hidden'));

window.openEditCommitmentModal = function (id, fId) {
    const item = allCommitments.find(c => c.id === id);
    if (!item) return;
    modalTitle.textContent = "Edit Item";
    entryIdInput.value = item.id;
    entryFolderIdInput.value = item.folderId;
    entryNameInput.value = item.name;
    entryAmountInput.value = item.amount;
    entryDueInput.value = item.dueDate;
    entryStatusInput.value = item.status;
    editOnlyGroup.classList.remove('hidden');
    commitmentModal.classList.remove('hidden');
};

commitmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = entryIdInput.value;
    const fId = entryFolderIdInput.value;
    const isEdit = !!id;

    const payload = {
        name: entryNameInput.value.trim(),
        amount: entryAmountInput.value,
        dueDate: entryDueInput.value,
    };
    if (isEdit) {
        payload.id = id;
        payload.folderId = fId;
        payload.status = entryStatusInput.value;
    } else {
        payload.status = 'Pending';
    }

    commitmentModal.classList.add('hidden');
    showLoading();

    const action = isEdit ? 'editCommitment' : 'addCommitment';
    const res = await apiRequest(action, payload);
    if (res.status === 'success') {
        await fetchData(); // Re-fetch entire checklist
    } else {
        alert('Error: ' + res.message);
        hideLoading();
    }
});

window.markCustomStatus = async function (id, fId, newStatus) {
    showLoading();
    const res = await apiRequest('updateStatus', { folderId: fId, id: id, status: newStatus });
    if (res.status === 'success') await fetchData();
    else { alert('Error: ' + res.message); hideLoading(); }
}

window.deleteCommitmentEntry = async function (id, fId) {
    if (!confirm('Are you absolutely sure you want to delete this?')) return;
    showLoading();
    const res = await apiRequest('deleteCommitment', { folderId: fId, id: id });
    if (res.status === 'success') await fetchData();
    else { alert('Error: ' + res.message); hideLoading(); }
}

function showLoading() { loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
