import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const emptyTransaction = {
  description: '',
  type: 'income',
  category: 'Projeto',
  amount: '',
  gross_amount: '',
  own_amount: '',
  transfer_amount: '',
  date: new Date().toISOString().split('T')[0],
  payment_due_date: '',
  paid_at: '',
  status: 'expected',
  payment_method: '',
  source: 'manual',
  origin_label: '',
  financial_type: '',
  financial_scope: 'personal',
  recurrence_frequency: '',
  notes: '',
  is_recurring: false
};

const incomeCategories = ['Projeto', 'Serviço recorrente', 'Consultoria', 'Distribuição de projeto', 'Reembolso', 'Outros'];
const expenseCategories = ['Software', 'Assinaturas', 'Tráfego pago', 'Equipamentos', 'Banco/cartão', 'Impostos', 'Hospedagem', 'Plugin', 'Domínio', 'Outros'];
const personalExpenseCategories = ['Assinaturas', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Moradia', 'Lazer', 'Cartão de crédito', 'Academia', 'Impostos', 'Outros'];
const statusLabels = { expected: 'Previsto', paid: 'Pago', overdue: 'Atrasado', canceled: 'Cancelado' };
const financialTypeLabels = {
  revenue: 'Receita / NF',
  payment_received: 'Pagamento recebido',
  transfer: 'Repasse',
  operational_expense: 'Despesa operacional',
  reimbursement: 'Reembolso',
  personal_expense: 'Despesa pessoal'
};
const scopeLabels = {
  personal: 'Pessoal',
  work: 'Trabalho',
  project: 'Projeto'
};
const recurrenceLabels = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  yearly: 'Anual'
};
const sourceLabels = {
  project: 'Projeto',
  project_distribution: 'Distribuição',
  reimbursement: 'Reembolso',
  renegotiation: 'Renegociação',
  recurring: 'Recorrente',
  manual: 'Outro / Manual'
};

const emptySummary = {
  bank_balance: 0,
  gross_revenue_total: 0,
  expected_month: 0,
  received: 0,
  personal_expenses: 0,
  work_expenses: 0,
  transfers: 0,
  own_amount: 0,
  projected_balance: 0,
  personal_projected_balance: 0,
  recurring_expenses: 0,
  total_debt: 0,
  current_card_bill: 0,
  fixed_installments: 0
};

function parseCurrency(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export default function PersonalFinance() {
  const [summary, setSummary] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [renegotiations, setRenegotiations] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({
    month: '',
    year: '',
    type: '',
    status: '',
    category: '',
    source: '',
    financial_scope: '',
    financial_type: '',
    is_recurring: ''
  });
  const [transactionForm, setTransactionForm] = useState(emptyTransaction);
  const [statusForm, setStatusForm] = useState({
    total_bank_balance: '',
    total_debt: '',
    credit_card_bill: ''
  });
  const [debtForm, setDebtForm] = useState({
    description: '',
    installment_value: '',
    total_installments: '',
    start_date: new Date().toISOString().split('T')[0]
  });

  const loadData = useCallback(async () => {
    try {
      const query = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
      ).toString();
      const summaryQuery = new URLSearchParams();
      if (filters.month && filters.year) {
        summaryQuery.set('month', filters.month);
        summaryQuery.set('year', filters.year);
      }
      const safeGet = async (url, fallback, label) => {
        try {
          const response = await api.get(url);
          return response.data;
        } catch (err) {
          console.error(`Erro ao carregar ${label}`, err.response?.data || err);
          setFeedback(current => current || `Erro ao carregar ${label}. Usando dados zerados temporariamente.`);
          return fallback;
        }
      };

      const [summaryData, dashboardData, transactionsData, renegotiationsData] = await Promise.all([
        safeGet(`/personal/summary?${summaryQuery.toString()}`, emptySummary, 'resumo pessoal'),
        safeGet('/personal/dashboard', {}, 'indicadores pessoais'),
        safeGet(`/personal/transactions?${query}`, [], 'lançamentos pessoais'),
        safeGet('/personal/renegotiations', [], 'renegociacoes')
      ]);

      setSummary({ ...emptySummary, ...summaryData });
      setDashboard(dashboardData);
      setTransactions(transactionsData);
      setRenegotiations(renegotiationsData);
      setStatusForm({
        total_bank_balance: String(dashboardData.bank_balance || ''),
        total_debt: String(dashboardData.total_debt || ''),
        credit_card_bill: String(dashboardData.current_card_bill || '')
      });
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar financeiro pessoal.');
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const categories = transactionForm.financial_type === 'personal_expense'
    ? personalExpenseCategories
    : transactionForm.type === 'income'
      ? incomeCategories
      : expenseCategories;
  const incomeRows = useMemo(() => transactions.filter(item => item.type === 'income'), [transactions]);
  const expenseRows = useMemo(() => transactions.filter(item => item.type === 'expense'), [transactions]);
  const isManualOrigin = transactionForm.source === 'manual';

  function formatSource(item) {
    return item.origin_label || sourceLabels[item.source] || item.source || '-';
  }

  function formatFinancialType(item) {
    return financialTypeLabels[item.financial_type] || (item.type === 'expense' ? 'Despesa' : 'Receita');
  }

  function formatScope(item) {
    return scopeLabels[item.financial_scope] || 'Pessoal';
  }

  function resetTransactionForm() {
    setTransactionForm(emptyTransaction);
    setEditing(null);
  }

  function startEdit(item) {
    setEditing(item);
    setTransactionForm({
      description: item.description || '',
      type: item.type || 'income',
      category: item.category || 'Outros',
      amount: String(item.amount || ''),
      gross_amount: String(item.gross_amount || ''),
      own_amount: String(item.own_amount || ''),
      transfer_amount: String(item.transfer_amount || ''),
      date: item.date || new Date().toISOString().split('T')[0],
      payment_due_date: item.payment_due_date || '',
      paid_at: item.paid_at || '',
      status: item.status || 'expected',
      payment_method: item.payment_method || '',
      source: item.source || 'manual',
      origin_label: item.origin_label || '',
      financial_type: item.financial_type || '',
      financial_scope: item.financial_scope || 'personal',
      recurrence_frequency: item.recurrence_frequency || '',
      notes: item.notes || '',
      is_recurring: Boolean(item.is_recurring)
    });
  }

  async function handleSaveTransaction(e) {
    e.preventDefault();
    setFeedback('');

    const payload = {
      ...transactionForm,
      amount: parseCurrency(transactionForm.amount),
      gross_amount: transactionForm.gross_amount ? parseCurrency(transactionForm.gross_amount) : null,
      own_amount: transactionForm.own_amount ? parseCurrency(transactionForm.own_amount) : null,
      transfer_amount: transactionForm.transfer_amount ? parseCurrency(transactionForm.transfer_amount) : null,
      payment_due_date: transactionForm.payment_due_date || null,
      paid_at: transactionForm.paid_at || null,
      financial_type: transactionForm.financial_type || null,
      financial_scope: transactionForm.financial_scope || 'personal',
      recurrence_frequency: transactionForm.is_recurring ? transactionForm.recurrence_frequency || 'monthly' : null,
      origin_label: transactionForm.source === 'manual' ? transactionForm.origin_label.trim() : '',
      is_recurring: transactionForm.is_recurring ? 1 : 0
    };

    try {
      if (editing) {
        await api.put(`/personal/transactions/${editing.id}`, payload);
        setFeedback('Lançamento atualizado.');
      } else {
        await api.post('/personal/transactions', payload);
        setFeedback('Lançamento criado.');
      }
      resetTransactionForm();
      await loadData();
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar lançamento.');
    }
  }

  async function handleStatus(item, status) {
    try {
      await api.patch(`/personal/transactions/${item.id}/status`, { status });
      await loadData();
      setFeedback('Status atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar status.');
    }
  }

  async function handleArchive(item) {
    const confirmed = window.confirm('Deseja arquivar este lançamento?');
    if (!confirmed) return;

    try {
      await api.delete(`/personal/transactions/${item.id}`);
      await loadData();
      setFeedback('Lançamento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar lançamento.');
    }
  }

  async function handleSaveStatus(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put('/personal/status', {
        total_bank_balance: parseCurrency(statusForm.total_bank_balance),
        total_debt: parseCurrency(statusForm.total_debt),
        credit_card_bill: parseCurrency(statusForm.credit_card_bill)
      });
      await loadData();
      setFeedback('Indicadores pessoais atualizados.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar indicadores.');
    }
  }

  async function handleCreateDebt(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/personal/renegotiations', {
        ...debtForm,
        installment_value: parseCurrency(debtForm.installment_value),
        total_installments: Number(debtForm.total_installments || 0)
      });
      setDebtForm({
        description: '',
        installment_value: '',
        total_installments: '',
        start_date: new Date().toISOString().split('T')[0]
      });
      await loadData();
      setFeedback('Renegociação adicionada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar renegociação.');
    }
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const formatDate = value => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '-';

  function renderRows(rows, kind) {
    return (
      <div className="transaction-table">
        <div className="table-head">
          <span>Data</span>
          <span>Descrição</span>
          <span>Categoria</span>
          <span>Tipo/Escopo</span>
          <span>{kind === 'income' ? 'Origem' : 'Origem/Forma'}</span>
          <span>Status</span>
          <span>Valor</span>
          <span>Acoes</span>
        </div>
        {rows.map(item => (
          <article key={item.id}>
            <span>{formatDate(item.date)}</span>
            <strong>{item.description}</strong>
            <span>{item.category}</span>
            <span className="scope-cell">
              <span className={`scope-badge ${item.financial_scope || 'personal'}`}>{formatScope(item)}</span>
              <small>{formatFinancialType(item)}{item.is_recurring ? ` - ${recurrenceLabels[item.recurrence_frequency] || 'recorrente'}` : ''}</small>
            </span>
            <span>{kind === 'income' ? formatSource(item) : item.payment_method || formatSource(item)}</span>
            <span className={`status ${item.status}`}>{statusLabels[item.status] || item.status}</span>
            <strong>{formatCurrency(item.amount)}</strong>
            <div className="row-actions">
              <button onClick={() => startEdit(item)}>Editar</button>
              {item.status !== 'paid' && <button onClick={() => handleStatus(item, 'paid')}>Pago</button>}
              {item.status !== 'canceled' && <button onClick={() => handleStatus(item, 'canceled')}>Cancelar</button>}
              <button className="danger" onClick={() => handleArchive(item)}>Arquivar</button>
            </div>
          </article>
        ))}
        {rows.length === 0 && <p className="empty-msg">Nenhum lançamento encontrado.</p>}
      </div>
    );
  }

  return (
    <div className="personal-finance-container">
      <header className="page-header">
        <div>
          <h1>Financeiro Pessoal</h1>
          <p>Controle privado do seu dinheiro, separado do financeiro global dos projetos.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="personal-summary">
        <div className="summary-card"><span>Saldo em bancos</span><strong>{formatCurrency(summary?.bank_balance)}</strong></div>
        <div className="summary-card income"><span>Faturamento total</span><strong>{formatCurrency(summary?.gross_revenue_total)}</strong></div>
        <div className="summary-card income"><span>Previsto no mês</span><strong>{formatCurrency(summary?.expected_month)}</strong></div>
        <div className="summary-card income"><span>Recebido</span><strong>{formatCurrency(summary?.received)}</strong></div>
        <div className="summary-card debt"><span>Despesas pessoais</span><strong>{formatCurrency(summary?.personal_expenses)}</strong></div>
        <div className="summary-card debt"><span>Despesas trabalho</span><strong>{formatCurrency(summary?.work_expenses)}</strong></div>
        <div className="summary-card debt"><span>Repasses</span><strong>{formatCurrency(summary?.transfers)}</strong></div>
        <div className="summary-card fixed"><span>Minha parte</span><strong>{formatCurrency(summary?.own_amount)}</strong></div>
        <div className="summary-card fixed"><span>Saldo previsto</span><strong>{formatCurrency(summary?.projected_balance)}</strong></div>
        <div className="summary-card fixed"><span>Saldo pessoal previsto</span><strong>{formatCurrency(summary?.personal_projected_balance)}</strong></div>
        <div className="summary-card debt"><span>Recorrentes</span><strong>{formatCurrency(summary?.recurring_expenses)}</strong></div>
        <div className="summary-card debt"><span>Dívida total</span><strong>{formatCurrency(summary?.total_debt ?? dashboard?.total_debt)}</strong></div>
        <div className="summary-card card-bill"><span>Fatura atual</span><strong>{formatCurrency(summary?.current_card_bill ?? dashboard?.current_card_bill)}</strong></div>
        <div className="summary-card fixed"><span>Parcelas fixas</span><strong>{formatCurrency(summary?.fixed_installments ?? dashboard?.fixed_debts_month)}</strong></div>
      </section>

      <section className="filters-panel">
        <select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
          <option value="">Todos os meses</option>
          {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>
        <input value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })} placeholder="Ano" />
        <select value={filters.financial_scope} onChange={e => setFilters({ ...filters, financial_scope: e.target.value })}>
          <option value="">Todos os escopos</option>
          <option value="personal">Pessoal</option>
          <option value="work">Trabalho</option>
          <option value="project">Projetos</option>
        </select>
        <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
          <option value="">Todos os tipos</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
        </select>
        <select value={filters.financial_type} onChange={e => setFilters({ ...filters, financial_type: e.target.value })}>
          <option value="">Todos financeiros</option>
          <option value="personal_expense">Despesas pessoais</option>
          <option value="transfer">Repasses</option>
          <option value="revenue">Receita / NF</option>
          <option value="payment_received">Pagamento recebido</option>
          <option value="operational_expense">Despesa operacional</option>
          <option value="reimbursement">Reembolso</option>
        </select>
        <select value={filters.is_recurring} onChange={e => setFilters({ ...filters, is_recurring: e.target.value })}>
          <option value="">Todos</option>
          <option value="1">Recorrentes</option>
        </select>
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Todos os status</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })} placeholder="Categoria" />
        <select value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })}>
          <option value="">Todas as origens</option>
          {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <div className="personal-grid">
        <section className="panel wide">
          <h2>{editing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          <form onSubmit={handleSaveTransaction}>
            <input value={transactionForm.description} onChange={e => setTransactionForm({ ...transactionForm, description: e.target.value })} placeholder="Descrição" required />
            <select value={transactionForm.type} onChange={e => setTransactionForm({ ...transactionForm, type: e.target.value, category: e.target.value === 'income' ? 'Projeto' : 'Software', financial_type: e.target.value === 'income' ? 'revenue' : 'personal_expense', financial_scope: e.target.value === 'income' ? 'work' : 'personal' })}>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
            </select>
            <select value={transactionForm.category} onChange={e => setTransactionForm({ ...transactionForm, category: e.target.value })}>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
            <input value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} placeholder="Valor" required />
            <input value={transactionForm.gross_amount} onChange={e => setTransactionForm({ ...transactionForm, gross_amount: e.target.value })} placeholder="Valor bruto" />
            <input value={transactionForm.own_amount} onChange={e => setTransactionForm({ ...transactionForm, own_amount: e.target.value })} placeholder="Minha parte" />
            <input value={transactionForm.transfer_amount} onChange={e => setTransactionForm({ ...transactionForm, transfer_amount: e.target.value })} placeholder="Repasses" />
            <input type="date" value={transactionForm.date} onChange={e => setTransactionForm({ ...transactionForm, date: e.target.value })} required />
            <input type="date" value={transactionForm.payment_due_date} onChange={e => setTransactionForm({ ...transactionForm, payment_due_date: e.target.value })} title="Data prevista de pagamento" />
            <input type="date" value={transactionForm.paid_at} onChange={e => setTransactionForm({ ...transactionForm, paid_at: e.target.value })} title="Data real de pagamento" />
            <select value={transactionForm.status} onChange={e => setTransactionForm({ ...transactionForm, status: e.target.value })}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select
              value={transactionForm.financial_type}
              onChange={e => {
                const financialType = e.target.value;
                setTransactionForm({
                  ...transactionForm,
                  financial_type: financialType,
                  type: ['personal_expense', 'operational_expense', 'transfer'].includes(financialType) ? 'expense' : 'income',
                  financial_scope: financialType === 'personal_expense' ? 'personal' : financialType === 'operational_expense' ? transactionForm.financial_scope : 'work',
                  category: financialType === 'personal_expense' ? 'Assinaturas' : transactionForm.category
                });
              }}
            >
              <option value="">Tipo financeiro</option>
              <option value="revenue">Receita / NF</option>
              <option value="payment_received">Pagamento recebido</option>
              <option value="transfer">Repasse</option>
              <option value="operational_expense">Despesa operacional</option>
              <option value="reimbursement">Reembolso</option>
              <option value="personal_expense">Despesa pessoal</option>
            </select>
            <select value={transactionForm.financial_scope} onChange={e => setTransactionForm({ ...transactionForm, financial_scope: e.target.value })}>
              <option value="personal">Pessoal</option>
              <option value="work">Trabalho</option>
              <option value="project">Projeto</option>
            </select>
            <input value={transactionForm.payment_method} onChange={e => setTransactionForm({ ...transactionForm, payment_method: e.target.value })} placeholder="Forma de pagamento" />
            <select
              value={transactionForm.source}
              onChange={e => setTransactionForm({
                ...transactionForm,
                source: e.target.value,
                origin_label: e.target.value === 'manual' ? transactionForm.origin_label : ''
              })}
            >
              {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {isManualOrigin && (
              <input
                className="origin-label-input"
                value={transactionForm.origin_label}
                onChange={e => setTransactionForm({ ...transactionForm, origin_label: e.target.value })}
                placeholder="Nome da origem"
              />
            )}
            <input value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="Observação" />
            <label className="checkbox-line">
              <input type="checkbox" checked={transactionForm.is_recurring} onChange={e => setTransactionForm({ ...transactionForm, is_recurring: e.target.checked })} />
              Recorrente
            </label>
            {transactionForm.is_recurring && (
              <select value={transactionForm.recurrence_frequency} onChange={e => setTransactionForm({ ...transactionForm, recurrence_frequency: e.target.value })}>
                <option value="">Frequência</option>
                <option value="monthly">Mensal</option>
                <option value="weekly">Semanal</option>
                <option value="yearly">Anual</option>
              </select>
            )}
            <button type="submit">{editing ? 'Salvar alterações' : 'Adicionar lançamento'}</button>
            {editing && <button type="button" className="btn-cancel" onClick={resetTransactionForm}>Cancelar edição</button>}
          </form>
        </section>

        <section className="panel">
          <h2>Atualizar indicadores</h2>
          <form onSubmit={handleSaveStatus}>
            <label>Saldo total em bancos</label>
            <input value={statusForm.total_bank_balance} onChange={e => setStatusForm({ ...statusForm, total_bank_balance: e.target.value })} />
            <label>Dívida total</label>
            <input value={statusForm.total_debt} onChange={e => setStatusForm({ ...statusForm, total_debt: e.target.value })} />
            <label>Fatura do cartão</label>
            <input value={statusForm.credit_card_bill} onChange={e => setStatusForm({ ...statusForm, credit_card_bill: e.target.value })} />
            <button type="submit">Salvar indicadores</button>
          </form>
        </section>
      </div>

      <section className="transactions-panel">
        <h2>Receitas</h2>
        {renderRows(incomeRows, 'income')}
      </section>

      <section className="transactions-panel">
        <h2>Despesas</h2>
        {renderRows(expenseRows, 'expense')}
      </section>

      <section className="renegotiations-panel">
        <h2>Renegociacoes</h2>
        <form onSubmit={handleCreateDebt} className="renegotiation-form">
          <input value={debtForm.description} onChange={e => setDebtForm({ ...debtForm, description: e.target.value })} placeholder="Descrição" required />
          <input value={debtForm.installment_value} onChange={e => setDebtForm({ ...debtForm, installment_value: e.target.value })} placeholder="Valor da parcela" required />
          <input type="number" value={debtForm.total_installments} onChange={e => setDebtForm({ ...debtForm, total_installments: e.target.value })} placeholder="Total de parcelas" />
          <input type="date" value={debtForm.start_date} onChange={e => setDebtForm({ ...debtForm, start_date: e.target.value })} required />
          <button type="submit">Adicionar</button>
        </form>
        <div className="renegotiations-list">
          {renegotiations.map(item => (
            <article key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <span>Inicio em {formatDate(item.start_date)}</span>
              </div>
              <strong>{formatCurrency(item.installment_value)}</strong>
            </article>
          ))}
          {renegotiations.length === 0 && <p>Nenhuma renegociação cadastrada.</p>}
        </div>
      </section>
    </div>
  );
}
