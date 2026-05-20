const ADDITIONAL_INCOME_TYPES = ['revenue', 'income', 'scope_increase', 'scope_adjustment', 'adjustment_positive'];
const PAYMENT_TYPES = ['payment_received', 'received_payment'];
const OPERATIONAL_EXPENSE_TYPES = ['operational_expense', 'expense', 'operational_cost'];
const TRANSFER_TYPES = ['transfer'];
const NEGATIVE_ADJUSTMENT_TYPES = ['adjustment_negative'];
const ACTIVE_STATUSES = ['pending', 'expected', 'paid', 'reimbursed'];
const RECEIVED_STATUSES = ['paid', 'reimbursed', 'received'];

function isTruthy(value) {
    return value === true || value === 1 || value === '1';
}

function money(value) {
    return Number(value || 0);
}

function normalizeType(row) {
    if (row.financial_type) return row.financial_type;

    const map = {
        income: 'revenue',
        received_payment: 'payment_received',
        reimbursement: 'reimbursement',
        scope_adjustment: 'scope_increase',
        scope_increase: 'scope_increase',
        expense: 'operational_expense',
        operational_cost: 'operational_expense',
        transfer: 'transfer'
    };

    return map[row.type] || row.type;
}

function gross(row) {
    return money(row.gross_amount ?? row.amount);
}

function own(row) {
    if (row.own_amount !== undefined && row.own_amount !== null) return money(row.own_amount);
    return Math.max(0, gross(row) - transfer(row));
}

function transfer(row) {
    if (row.transfer_amount !== undefined && row.transfer_amount !== null) return money(row.transfer_amount);
    return TRANSFER_TYPES.includes(normalizeType(row)) ? gross(row) : 0;
}

function affectsProjectTotal(row) {
    return row.affects_project_total === undefined || row.affects_project_total === null || isTruthy(row.affects_project_total);
}

function billableToClient(row) {
    return isTruthy(row.billable_to_client) || (isTruthy(row.reimbursable) && affectsProjectTotal(row));
}

function isActive(row) {
    return Number(row.archived || 0) !== 1 && row.status !== 'canceled' && row.status !== 'archived';
}

function isReceived(row) {
    return RECEIVED_STATUSES.includes(row.status);
}

async function calculateProjectFinancialSummary(db, projectId) {
    const project = await db.get('SELECT base_value FROM projects WHERE id = ?', [projectId]);
    const rows = await db.all(`
        SELECT *
        FROM project_financial_entries
        WHERE project_id = ?
    `, [projectId]);

    const activeRows = rows.filter(isActive);
    const contractValue = money(project?.base_value);

    const additionalIncome = activeRows
        .filter(row => ADDITIONAL_INCOME_TYPES.includes(normalizeType(row)))
        .filter(affectsProjectTotal)
        .reduce((sum, row) => sum + gross(row), 0);

    const negativeAdjustments = activeRows
        .filter(row => NEGATIVE_ADJUSTMENT_TYPES.includes(normalizeType(row)))
        .filter(affectsProjectTotal)
        .reduce((sum, row) => sum + gross(row), 0);

    const billableReimbursableCosts = activeRows
        .filter(row => OPERATIONAL_EXPENSE_TYPES.includes(normalizeType(row)))
        .filter(row => isTruthy(row.reimbursable) && billableToClient(row))
        .reduce((sum, row) => sum + gross(row), 0);

    const updatedValue = contractValue + additionalIncome + billableReimbursableCosts - negativeAdjustments;

    const receivedClient = activeRows
        .filter(row => isReceived(row))
        .filter(row => (
            ADDITIONAL_INCOME_TYPES.includes(normalizeType(row)) ||
            PAYMENT_TYPES.includes(normalizeType(row)) ||
            normalizeType(row) === 'reimbursement'
        ))
        .reduce((sum, row) => sum + gross(row), 0);

    const operationalExpenses = activeRows
        .filter(row => OPERATIONAL_EXPENSE_TYPES.includes(normalizeType(row)))
        .reduce((sum, row) => sum + gross(row), 0);

    const paidOperationalExpenses = activeRows
        .filter(row => OPERATIONAL_EXPENSE_TYPES.includes(normalizeType(row)) && row.status === 'paid')
        .reduce((sum, row) => sum + gross(row), 0);

    const explicitTransferRows = activeRows.filter(row => TRANSFER_TYPES.includes(normalizeType(row)));
    const transferRows = explicitTransferRows.length > 0
        ? explicitTransferRows
        : activeRows.filter(row => transfer(row) > 0);

    const transfersTotal = transferRows
        .reduce((sum, row) => sum + transfer(row), 0);

    const transfersPending = transferRows
        .filter(row => ['pending', 'expected'].includes(row.status))
        .reduce((sum, row) => sum + transfer(row), 0);

    const transfersPaid = transferRows
        .filter(row => row.status === 'paid')
        .reduce((sum, row) => sum + transfer(row), 0);

    const reimbursablePending = activeRows
        .filter(row => OPERATIONAL_EXPENSE_TYPES.includes(normalizeType(row)))
        .filter(row => isTruthy(row.reimbursable) && !['paid', 'reimbursed'].includes(row.status))
        .reduce((sum, row) => sum + gross(row), 0);

    const explicitOwnAmount = activeRows
        .filter(row => ADDITIONAL_INCOME_TYPES.includes(normalizeType(row)) || PAYMENT_TYPES.includes(normalizeType(row)))
        .reduce((sum, row) => sum + (row.own_amount !== undefined && row.own_amount !== null ? money(row.own_amount) : 0), 0);

    const calculatedOwnAmount = Math.max(0, updatedValue - transfersTotal - operationalExpenses);
    const ownAmount = explicitOwnAmount > 0 ? explicitOwnAmount : calculatedOwnAmount;
    const netBalance = updatedValue - operationalExpenses - transfersTotal;
    const cashCurrent = receivedClient - paidOperationalExpenses - transfersPaid;
    const pendingClient = Math.max(0, updatedValue - receivedClient);

    return {
        contract_value: contractValue,
        base_contract_value: contractValue,
        gross_revenue: activeRows
            .filter(row => ADDITIONAL_INCOME_TYPES.includes(normalizeType(row)) || PAYMENT_TYPES.includes(normalizeType(row)))
            .reduce((sum, row) => sum + gross(row), 0),
        additional_income: additionalIncome,
        billable_reimbursable_costs: billableReimbursableCosts,
        negative_adjustments: negativeAdjustments,
        expenses: operationalExpenses,
        total_expenses: operationalExpenses,
        operational_expenses: operationalExpenses,
        transfers_total: transfersTotal,
        transfers_pending: transfersPending,
        pending_transfer: transfersPending,
        updated_value: updatedValue,
        updated_total_value: updatedValue,
        received: receivedClient,
        total_received: receivedClient,
        received_client: receivedClient,
        pending: pendingClient,
        total_pending: pendingClient,
        pending_client: pendingClient,
        reimbursement_total: activeRows
            .filter(row => normalizeType(row) === 'reimbursement' && isReceived(row))
            .reduce((sum, row) => sum + gross(row), 0),
        reimbursed_amount: activeRows
            .filter(row => normalizeType(row) === 'reimbursement' && isReceived(row))
            .reduce((sum, row) => sum + gross(row), 0),
        reimbursable_expenses: reimbursablePending,
        pending_reimbursement: reimbursablePending,
        net_balance: netBalance,
        estimated_net_balance: netBalance,
        cash_current: cashCurrent,
        current_cash: cashCurrent,
        own_amount: ownAmount,
        my_share: ownAmount,
        active_statuses: ACTIVE_STATUSES
    };
}

module.exports = {
    ADDITIONAL_INCOME_TYPES,
    EXPENSE_TYPES: OPERATIONAL_EXPENSE_TYPES,
    OPERATIONAL_EXPENSE_TYPES,
    REIMBURSEMENT_TYPES: ['reimbursement'],
    RECEIVED_PAYMENT_TYPES: PAYMENT_TYPES,
    TRANSFER_TYPES,
    calculateProjectFinancialSummary,
    normalizeType
};
