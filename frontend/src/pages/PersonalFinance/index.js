import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const emptyTransaction = {
  description: '',
  type: 'income',
  category: 'Projeto',
  amount: '',
  date: new Date().toISOString().split('T')[0],
  status: 'expected',
  payment_method: '',
  source: 'manual',
  origin_label: '',
  notes: '',
  is_recurring: false
};

const incomeCategories = ['Projeto', 'Servico recorrente', 'Consultoria', 'Distribuicao de projeto', 'Reembolso', 'Outros'];
const expenseCategories = ['Software', 'Assinaturas', 'Trafego pago', 'Equipamentos', 'Banco/cartao', 'Impostos', 'Hospedagem', 'Plugin', 'Dominio', 'Outros'];
const statusLabels = { expected: 'previsto', paid: 'pago', overdue: 'atrasado', canceled: 'cancelado' };
const sourceLabels = {
  project: 'projeto',
  project_distribution: 'distribuicao',
  reimbursement: 'reembolso',
  renegotiation: 'renegociacao',
  recurring: 'recorrente',
  manual: 'Outro / Manual'
};

function parseCurrency(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export default function PersonalFinance() {
  const today = new Date();
  const [summary, setSummary] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [renegotiations, setRenegotiations] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({
    month: String(today.getMonth() + 1).padStart(2, '0'),
    year: String(today.getFullYear()),
    type: '',
    status: '',
    category: '',
    source: ''
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
      const [summaryRes, dashboardRes, transactionsRes, renegotiationsRes] = await Promise.all([
        api.get(`/personal/summary?month=${filters.month}&year=${filters.year}`),
        api.get('/personal/dashboard'),
        api.get(`/personal/transactions?${query}`),
        api.get('/personal/renegotiations')
      ]);

      setSummary(summaryRes.data);
      setDashboard(dashboardRes.data);
      setTransactions(transactionsRes.data);
      setRenegotiations(renegotiationsRes.data);
      setStatusForm({
        total_bank_balance: String(dashboardRes.data.bank_balance || ''),
        total_debt: String(dashboardRes.data.total_debt || ''),
        credit_card_bill: String(dashboardRes.data.current_card_bill || '')
      });
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar financeiro pessoal.');
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const categories = transactionForm.type === 'income' ? incomeCategories : expenseCategories;
  const incomeRows = useMemo(() => transactions.filter(item => item.type === 'income'), [transactions]);
  const expenseRows = useMemo(() => transactions.filter(item => item.type === 'expense'), [transactions]);
  const isManualOrigin = transactionForm.source === 'manual';

  function formatSource(item) {
    return item.origin_label || sourceLabels[item.source] || item.source || '-';
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
      date: item.date || new Date().toISOString().split('T')[0],
      status: item.status || 'expected',
      payment_method: item.payment_method || '',
      source: item.source || 'manual',
      origin_label: item.origin_label || '',
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
      origin_label: transactionForm.source === 'manual' ? transactionForm.origin_label.trim() : '',
      is_recurring: transactionForm.is_recurring ? 1 : 0
    };

    try {
      if (editing) {
        await api.put(`/personal/transactions/${editing.id}`, payload);
        setFeedback('Lancamento atualizado.');
      } else {
        await api.post('/personal/transactions', payload);
        setFeedback('Lancamento criado.');
      }
      resetTransactionForm();
      await loadData();
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar lancamento.');
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
    const confirmed = window.confirm('Deseja arquivar este lancamento?');
    if (!confirmed) return;

    try {
      await api.delete(`/personal/transactions/${item.id}`);
      await loadData();
      setFeedback('Lancamento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar lancamento.');
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
      setFeedback('Renegociacao adicionada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar renegociacao.');
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
          <span>Descricao</span>
          <span>Categoria</span>
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
        {rows.length === 0 && <p className="empty-msg">Nenhum lancamento encontrado.</p>}
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
        <div className="summary-card income"><span>Receitas do mes</span><strong>{formatCurrency(summary?.total_income_month)}</strong></div>
        <div className="summary-card debt"><span>Despesas do mes</span><strong>{formatCurrency(summary?.total_expense_month)}</strong></div>
        <div className="summary-card fixed"><span>Saldo previsto</span><strong>{formatCurrency(summary?.projected_balance)}</strong></div>
        <div className="summary-card debt"><span>Divida total</span><strong>{formatCurrency(summary?.total_debt ?? dashboard?.total_debt)}</strong></div>
        <div className="summary-card card-bill"><span>Fatura atual</span><strong>{formatCurrency(summary?.current_card_bill ?? dashboard?.current_card_bill)}</strong></div>
        <div className="summary-card fixed"><span>Parcelas fixas</span><strong>{formatCurrency(summary?.fixed_installments ?? dashboard?.fixed_debts_month)}</strong></div>
      </section>

      <section className="filters-panel">
        <select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
          {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>
        <input value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })} placeholder="Ano" />
        <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
          <option value="">Todos os tipos</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
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
          <h2>{editing ? 'Editar lancamento' : 'Novo lancamento'}</h2>
          <form onSubmit={handleSaveTransaction}>
            <input value={transactionForm.description} onChange={e => setTransactionForm({ ...transactionForm, description: e.target.value })} placeholder="Descricao" required />
            <select value={transactionForm.type} onChange={e => setTransactionForm({ ...transactionForm, type: e.target.value, category: e.target.value === 'income' ? 'Projeto' : 'Software' })}>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
            </select>
            <select value={transactionForm.category} onChange={e => setTransactionForm({ ...transactionForm, category: e.target.value })}>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
            <input value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} placeholder="Valor" required />
            <input type="date" value={transactionForm.date} onChange={e => setTransactionForm({ ...transactionForm, date: e.target.value })} required />
            <select value={transactionForm.status} onChange={e => setTransactionForm({ ...transactionForm, status: e.target.value })}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
            <input value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="Observacao" />
            <label className="checkbox-line">
              <input type="checkbox" checked={transactionForm.is_recurring} onChange={e => setTransactionForm({ ...transactionForm, is_recurring: e.target.checked })} />
              Recorrente
            </label>
            <button type="submit">{editing ? 'Salvar alteracoes' : 'Adicionar lancamento'}</button>
            {editing && <button type="button" className="btn-cancel" onClick={resetTransactionForm}>Cancelar edicao</button>}
          </form>
        </section>

        <section className="panel">
          <h2>Atualizar indicadores</h2>
          <form onSubmit={handleSaveStatus}>
            <label>Saldo total em bancos</label>
            <input value={statusForm.total_bank_balance} onChange={e => setStatusForm({ ...statusForm, total_bank_balance: e.target.value })} />
            <label>Divida total</label>
            <input value={statusForm.total_debt} onChange={e => setStatusForm({ ...statusForm, total_debt: e.target.value })} />
            <label>Fatura do cartao</label>
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
          <input value={debtForm.description} onChange={e => setDebtForm({ ...debtForm, description: e.target.value })} placeholder="Descricao" required />
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
          {renegotiations.length === 0 && <p>Nenhuma renegociacao cadastrada.</p>}
        </div>
      </section>
    </div>
  );
}
