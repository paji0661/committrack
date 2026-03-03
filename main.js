// Mock Data injected for the Prototype
const mockData = [
    { name: 'Home Loan', ledger: 'Paji', amount: 434.00, dueDate: 'Target: 2030-04-12', status: 'Pending', type: 'Target' },
    { name: 'Car Installment', ledger: 'Addey', amount: 550.00, dueDate: '2026-03-25', status: 'Pending', type: 'Bill' },
    { name: 'Electric Bill (TNB)', ledger: 'Paji', amount: 124.50, dueDate: '2026-03-15', status: 'Paid', type: 'Bill' },
    { name: 'Wifi Unifi', ledger: 'Addey', amount: 99.00, dueDate: '2026-03-10', status: 'Paid', type: 'Bill' }
];

function renderTable() {
    const container = document.getElementById('ledger-list-container');

    let html = `
    <table>
        <thead>
            <tr>
                <th style="width: 50px; text-align: center;">Done</th>
                <th>Commitment Name</th>
                <th>Amount</th>
                <th>Due Date / Timeline</th>
                <th>Status</th>
                <th style="text-align: right;">Action</th>
            </tr>
        </thead>
        <tbody>
    `;

    mockData.forEach(item => {
        const isPaid = item.status === 'Paid';
        const badgeClass = isPaid ? 'badge-paid' : 'badge-pending';

        html += `
        <tr>
            <td style="text-align: center;">
                <input type="checkbox" class="custom-checkbox" ${isPaid ? 'checked' : ''}>
            </td>
            <td>
                <span class="td-name">${item.name}</span>
                <span class="td-ledger">Ledger: ${item.ledger}</span>
            </td>
            <td style="font-weight: 500;">
                RM ${item.amount.toFixed(2)}
            </td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">
                ${item.dueDate}
            </td>
            <td>
                <span class="badge ${badgeClass}">${item.status.toUpperCase()}</span>
            </td>
            <td style="text-align: right;">
                <button class="action-btn" title="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
            </td>
        </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    renderTable();
});
