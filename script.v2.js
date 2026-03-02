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
const addCommitmentBtn = document.getElementById('show-add-commitment-btn');
const aboutBtn = document.getElementById('about-btn');
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

const aboutModal = document.getElementById('about-modal');
const commitmentModal = document.getElementById('commitment-modal');
const closeCommitmentModalBtn = document.getElementById('close-commitment-modal-btn');
const commitmentForm = document.getElementById('commitment-form');
const entryIdInput = document.getElementById('entry-id');
const entryFolderIdInput = document.getElementById('entry-folder-id');
const entryNameInput = document.getElementById('entry-name');
const entryTypeInput = document.getElementById('entry-type');
const targetFieldsGroup = document.getElementById('target-fields-group');
const targetBalanceGroup = document.getElementById('target-balance-group');
const lblEntryAmount = document.getElementById('lbl-entry-amount');
const entryTotalAmountInput = document.getElementById('entry-total-amount');
const entryAmountInput = document.getElementById('entry-amount');
const entryBalanceInput = document.getElementById('entry-balance');
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
    headerEmailDisplay.textContent = '- ' + currentDisplayName;

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
aboutBtn.addEventListener('click', () => {
    aboutModal.classList.remove('hidden');
});

function closeAboutModal() {
    aboutModal.classList.add('hidden');
}

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
        // --- Prevent Future "Pending" Targets if they already exist in current month or are paid
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        filtered = allCommitments.filter(c => {
            if (c.status === 'Archived') return false;

            // For targets, if it's placed in a FUTURE month we hide it for now
            // But we only want to hide it if we don't *need* to see it yet.
            if (c.type === 'Target') {
                let d = new Date(c.dueDate);
                if (isNaN(d)) d = new Date();

                // If the target is due strictly after the current month/year
                if (d.getFullYear() > currentYear || (d.getFullYear() === currentYear && d.getMonth() > currentMonth)) {
                    // Hide future targets to prevent clutter
                    return false;
                }
            }
            return true;
        });

        // Compute Advance Payments
        computeAdvancePayments(allCommitments); // Pass the whole list so we can see all historical payments

        renderAnalytics(allCommitments); // We pass ALL items to analytics so Active Debt scanner can find the absolute latest balance across all months
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
        // Active view: newest first (Descending). Archives view: newest first (Descending)
        return b.sortDate - a.sortDate;
    });

    sortedGroups.forEach(groupDesc => {
        const monthKey = groupDesc.label;
        const sortedItems = groupDesc.items.sort((a, b) => {
            // Newest items sit at the top inside the month block
            return new Date(b.dueDate) - new Date(a.dueDate);
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
            let checkboxHtml = '';

            if (currentViewMode === 'ACTIVE') {
                if (item.status === 'Pending') {
                    if (item.type === 'Target') {
                        // Target type gets a special Pay button instead of checkbox
                        actionsHtml += `<button class="btn btn-sm btn-success" style="margin-right: 0.5rem;" onclick="promptTargetPayment('${item.id}', '${item.folderId}', '${item.name}', ${item.amount}, ${item.balance})">Pay</button>`;
                    } else {
                        // Normal type gets checkbox
                        const checkedState = selectedForBatch.find(u => u.id === item.id) ? 'checked' : '';
                        checkboxHtml = `<input type="checkbox" class="modern-checkbox" onchange="toggleBatchSelection(this, '${item.id}', '${item.folderId}')" ${checkedState}>`;
                    }

                    // Dimmed archive button
                    actionsHtml += `<button class="nav-link" style="opacity: 0.3; cursor: not-allowed;" title="Must be Paid to Archive">📦</button>`;
                } else if (item.status === 'Paid') {
                    actionsHtml += `<button class="nav-link" onclick="markCustomStatus('${item.id}', '${item.folderId}', 'Archived')" title="Archive">📦</button>`;
                }

                actionsHtml += `
                    <button class="nav-link" onclick="openEditCommitmentModal('${item.id}', '${item.folderId}')" title="Edit">✏️</button>
                    <button class="nav-link text-danger" onclick="deleteCommitmentEntry('${item.id}', '${item.folderId}')" title="Delete">🗑️</button>
                    ${checkboxHtml}
                 `;
            } else {
                // Archived View Actions
                actionsHtml += `<button class="nav-link" onclick="markCustomStatus('${item.id}', '${item.folderId}', 'Paid')" title="Unarchive">↩️</button>`;
                actionsHtml += `<button class="nav-link text-danger" onclick="deleteCommitmentEntry('${item.id}', '${item.folderId}')" title="Delete">🗑️</button>`;
            }

            const amountFormatted = parseFloat(item.amount).toLocaleString('ms-MY', { style: 'currency', currency: 'MYR' });

            let amountHtml = `<strong>${amountFormatted}</strong>`;

            // Only show Total / Balance if they are greater than 0
            if (item.totalAmount > 0 || item.balance > 0) {
                const totalFormatted = parseFloat(item.totalAmount).toLocaleString('ms-MY', { style: 'currency', currency: 'MYR' });
                const balanceFormatted = parseFloat(item.balance).toLocaleString('ms-MY', { style: 'currency', currency: 'MYR' });
                amountHtml += `<br><span style="font-size: 0.75rem; color: var(--text-muted);">Bal: ${balanceFormatted} | Tot: ${totalFormatted}</span>`;
            }

            // Display Target Complete Date instead of Due Date for Targets if it exists
            let displayDate = item.dueDate;
            if (item.type === 'Target' && item.dueDate) {
                displayDate = `<span style="font-size: 0.75rem; color: var(--text-muted);">Target:</span><br>${item.dueDate}`;
            }

            tr.innerHTML = `
                <td>${nameColHtml}</td>
                <td><span style="font-size: 0.8rem; color: var(--text-muted)">${item.sourceLedger}</span></td>
                <td>${amountHtml}</td>
                <td>${displayDate || '-'}</td>
                <td><span class="status-badge ${statusClass}">${item.status}</span></td>
                <td><div class="row-actions">${actionsHtml}</div></td>
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

// Calculate Advance Payments globally
function computeAdvancePayments(allItems) {
    const advContainer = document.getElementById('advance-payments-container');
    const advList = document.getElementById('advance-payments-list');
    if (!advContainer || !advList) return;

    advList.innerHTML = '';
    let hasAdvances = false;

    // We only care about Targets that are PAID, where the math implies an advance
    // Normally, paying more than 'amount' doesn't explicitly store 'advancePayment' in Google Script rn
    // BUT we can infer it if they have multiple Paid items for the same debt, 
    // or if we track the "amount" vs standard "amount" (if we had it).
    // Actually, since we don't have a distinct "Advance Payment" DB field right now,
    // let's look for Targets where `status === Paid` and calculate if the balance dropped by more than the stipulated `amount`.
    // Alternatively: we can just leave this UI ready for when they enter an extra amount, 
    // OR just use a simple heuristic: if a Target has multiple Paid entries in the *same* month.

    // For now, let's just make sure the UI accommodates it if we spot negative balances or manual flags.
    // If the balance is exactly 0, and they paid *more* than the previous balance, it's an advance/extra.
    // (This feature can be expanded backend later. For now, we hide it unless we implement a clear flag).
    // We will hide it dynamically for now since the backend logic for identifying "Advance Payment amount" isn't explicitly returned yet.
    advContainer.classList.add('hidden');
}

// --- SINGLE ANALYTICS DOUGHNUT ---
function renderAnalytics(allItems) {
    let pending = 0;
    let paid = 0;

    // Filter to current active month logic for doughnut chart
    const now = new Date();
    const currentMonthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    allItems.forEach(i => {
        let d = new Date(i.dueDate);
        if (isNaN(d)) d = new Date();
        const mLabel = d.toLocaleString('default', { month: 'long', year: 'numeric' });

        // Active chart only cares about the current month's fixed bills OR anything pending from the past
        if (mLabel === currentMonthLabel || (i.status === 'Pending' && i.status !== 'Archived')) {
            if (i.status === 'Paid') paid += parseFloat(i.amount);
            else if (i.status === 'Pending') pending += parseFloat(i.amount);
        }
    });

    // --- Render Active Debts ---
    const debtsTbody = document.getElementById('active-debts-tbody');
    const noDebtsMsg = document.getElementById('no-debts-msg');

    if (debtsTbody && noDebtsMsg) {
        debtsTbody.innerHTML = '';

        // Group by name to find the absolute latest balance across ALL data (even paid items)
        const targetMap = {};
        allItems.forEach(i => {
            if (i.type === 'Target' && i.status !== 'Archived') {
                const name = i.name.trim();
                // Take the one with the smallest balance (which implies the most recent payment / state)
                if (!targetMap[name] || i.balance < targetMap[name].balance) {
                    targetMap[name] = i;
                }
            }
        });

        const uniqueTargets = Object.values(targetMap).filter(i => parseFloat(i.totalAmount) > 0 && parseFloat(i.balance) > 0);

        if (uniqueTargets.length === 0) {
            noDebtsMsg.classList.remove('hidden');
            debtsTbody.parentElement.classList.add('hidden');
        } else {
            noDebtsMsg.classList.add('hidden');
            debtsTbody.parentElement.classList.remove('hidden');

            uniqueTargets.forEach(item => {
                const tr = document.createElement('tr');
                const total = parseFloat(item.totalAmount) || 0;
                const balance = parseFloat(item.balance) || 0;

                const totalFormatted = total.toLocaleString('ms-MY', { style: 'currency', currency: 'MYR' });
                const balanceFormatted = balance.toLocaleString('ms-MY', { style: 'currency', currency: 'MYR' });

                let progressPercent = 0;
                if (total > 0) {
                    progressPercent = Math.max(0, Math.min(100, ((total - balance) / total) * 100));
                }

                tr.innerHTML = `
                    <td><strong>${item.name}</strong></td>
                    <td>${totalFormatted}</td>
                    <td><span class="text-danger">${balanceFormatted}</span></td>
                    <td style="width: 25%; min-width: 80px;">
                        <div style="width: 100%; background: var(--surface); border-radius: 4px; height: 6px; overflow: hidden; margin-top: 4px;">
                            <div style="width: ${progressPercent}%; background: var(--success); height: 100%;"></div>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); text-align: right; margin-top: 3px;">
                            ${progressPercent.toFixed(1)}%
                        </div>
                    </td>
                `;
                debtsTbody.appendChild(tr);
            });
        }
    }

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
closeShareModalBtn.addEventListener('click', () => {
    shareLedgerModal.classList.add('hidden');
});

// Generic click-outside to close for ANY modal
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
    }
});

shareLedgerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = shareEmailInput.value.trim();

    // Convert YYYY-MM into "Month YYYY" string to match backend
    const [yearStr, monthNumStr] = shareMonthInput.value.split('-');
    const dateObj = new Date(parseInt(yearStr), parseInt(monthNumStr) - 1, 1);
    const targetMonthYear = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Backend API now requires targetMonthYear
    shareLedgerModal.classList.add('hidden');
    showLoading();
    const res = await apiRequest('shareFolder', { shareEmail: email, targetMonthYear: targetMonthYear });
    if (res.status === 'success') {
        alert(res.message);
    } else {
        alert('Error: ' + res.message);
    }

    hideLoading();
});


// Toggling Target Fields in Modal
window.toggleTargetFields = function () {
    const lblDue = document.getElementById('lbl-entry-due');
    if (entryTypeInput.value === 'Target') {
        targetFieldsGroup.classList.remove('hidden');
        targetBalanceGroup.classList.remove('hidden');
        lblEntryAmount.textContent = "Monthly Payment Amount";
        if (lblDue) lblDue.textContent = "Target Complete Date (Optional)";
    } else {
        targetFieldsGroup.classList.add('hidden');
        targetBalanceGroup.classList.add('hidden');
        lblEntryAmount.textContent = "Monthly Amount";
        if (lblDue) lblDue.textContent = "Due Date";
    }
}

// Auto Calculate Balance for Target types
window.autoCalculateBalance = function () {
    if (entryTypeInput.value === 'Target') {
        const total = parseFloat(entryTotalAmountInput.value) || 0;
        const monthly = parseFloat(entryAmountInput.value) || 0;

        // Only auto-calculate if total is provided
        if (total > 0) {
            const balance = total - monthly;
            // Prevent negative balance from auto-calc
            entryBalanceInput.value = balance > 0 ? balance.toFixed(2) : '0.00';
        }
    }
}

// Add / Edit
showAddCommitmentBtn.addEventListener('click', () => {
    modalTitle.textContent = "Add Item";
    commitmentForm.reset();
    entryIdInput.value = '';
    entryFolderIdInput.value = '';
    entryTypeInput.value = 'Fixed';
    entryTotalAmountInput.value = '';
    entryBalanceInput.value = '';
    toggleTargetFields();
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
    entryTypeInput.value = item.type || 'Fixed';
    toggleTargetFields();
    entryTotalAmountInput.value = (item.totalAmount && item.totalAmount != item.amount) ? item.totalAmount : '';
    entryAmountInput.value = item.amount;
    entryBalanceInput.value = (item.balance && item.balance != item.amount) ? item.balance : '';
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
        type: entryTypeInput.value,
        totalAmount: (entryTypeInput.value === 'Target' && entryTotalAmountInput.value) ? entryTotalAmountInput.value : 0,
        amount: entryAmountInput.value,
        balance: (entryTypeInput.value === 'Target' && entryBalanceInput.value) ? entryBalanceInput.value : 0,
        dueDate: entryDueInput.value, // It's fine to leave this blank or store the complete date. Apps script falls back to current month if empty strings aren't handled well, but the frontend will now label it as "target complete date".
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

window.promptTargetPayment = async function (id, fId, name, defaultAmount, currentBalance) {
    const amountStr = prompt(`How much are you paying for ${name} this month?\n(Current Balance: RM ${currentBalance.toFixed(2)})`, defaultAmount);

    if (amountStr === null) return; // User cancelled

    const paymentAmount = parseFloat(amountStr);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        alert("Please enter a valid payment amount greater than 0.");
        return;
    }

    if (paymentAmount > currentBalance && currentBalance > 0) {
        if (!confirm(`Warning: You are paying RM ${paymentAmount.toFixed(2)}, which is more than the current balance of RM ${currentBalance.toFixed(2)}.\n\nContinue?`)) {
            return;
        }
    }

    showLoading();
    const res = await apiRequest('processTargetPayment', { folderId: fId, id: id, paymentAmount: paymentAmount });
    if (res.status === 'success') {
        alert(res.message);
        await fetchData();
    } else {
        alert('Error: ' + res.message);
        hideLoading();
    }
}

function showLoading() { loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
