const ADDITIONAL_INCOME_TYPES = ['income', 'scope_adjustment', 'scope_increase'];
const EXPENSE_TYPES = ['expense', 'operational_cost', 'transfer'];
const REIMBURSEMENT_TYPES = ['reimbursement'];
const RECEIVED_PAYMENT_TYPES = ['received_payment'];
const RECEIVED_STATUSES = ['paid', 'reimbursed', 'received'];

function isTruthy(value) {
    return value === true || value === 1 || value === '1';
}

async function calculateProjectFinancialSummary(db, projectId) {
    const project = await db.get('SELECT base_value FROM projects WHERE id = ?', [projectId]);
    const rows = await db.all(`
        SELECT type, amount, status, affects_project_total, reimbursable
        FROM project_financial_entries
        WHERE project_id = ? AND archived = 0 AND status != 'canceled'
    `, [projectId]);

    const contractValue = Number(project?.base_value || 0);
    const additionalIncome = rows
        .filter(row => ADDITIONAL_INCOME_TYPES.includes(row.type))
        .filter(row => row.affects_project_total === undefined || row.affects_project_total === null || isTruthy(row.affects_project_total) || row.type === 'income' || row.type === 'scope_increase' || row.type === 'scope_adjustment')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenses = rows
        .filter(row => EXPENSE_TYPES.includes(row.type))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const reimbursementTotal = rows
        .filter(row => REIMBURSEMENT_TYPES.includes(row.type) && RECEIVED_STATUSES.includes(row.status))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const received = rows
        .filter(row => RECEIVED_STATUSES.includes(row.status))
        .filter(row => ADDITIONAL_INCOME_TYPES.includes(row.type) || RECEIVED_PAYMENT_TYPES.includes(row.type) || REIMBURSEMENT_TYPES.includes(row.type))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const reimbursableGross = rows
        .filter(row => EXPENSE_TYPES.includes(row.type) && isTruthy(row.reimbursable) && row.status !== 'reimbursed')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const updatedValue = contractValue + additionalIncome;
    const pending = Math.max(0, updatedValue - received);
    const reimbursementPending = Math.max(0, reimbursableGross - reimbursementTotal);
    const netBalance = updatedValue - expenses;

    return {
        contract_value: contractValue,
        base_contract_value: contractValue,
        additional_income: additionalIncome,
        expenses,
        total_expenses: expenses,
        updated_value: updatedValue,
        updated_total_value: updatedValue,
        received,
        total_received: received,
        pending,
        total_pending: pending,
        reimbursement_total: reimbursementTotal,
        reimbursed_amount: reimbursementTotal,
        reimbursable_expenses: reimbursementPending,
        net_balance: netBalance,
        estimated_net_balance: netBalance
    };
}

module.exports = {
    ADDITIONAL_INCOME_TYPES,
    EXPENSE_TYPES,
    REIMBURSEMENT_TYPES,
    RECEIVED_PAYMENT_TYPES,
    calculateProjectFinancialSummary
};
