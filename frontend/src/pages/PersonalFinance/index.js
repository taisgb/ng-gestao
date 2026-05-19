import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function PersonalFinance() {
  const [dashboard, setDashboard] = useState(null);
  const [renegotiations, setRenegotiations] = useState([]);
  const [feedback, setFeedback] = useState('');
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

  async function loadData() {
    try {
      const [dashboardRes, renegotiationsRes] = await Promise.all([
        api.get('/personal/dashboard'),
        api.get('/personal/renegotiations')
      ]);

      setDashboard(dashboardRes.data);
      setRenegotiations(renegotiationsRes.data);
      setStatusForm({
        total_bank_balance: String(dashboardRes.data.bank_balance || ''),
        total_debt: String(dashboardRes.data.total_debt || ''),
        credit_card_bill: String(dashboardRes.data.current_card_bill || '')
      });
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar financeiro pessoal.');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSaveStatus(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put('/personal/status', {
        total_bank_balance: Number(statusForm.total_bank_balance || 0),
        total_debt: Number(statusForm.total_debt || 0),
        credit_card_bill: Number(statusForm.credit_card_bill || 0)
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
        installment_value: Number(debtForm.installment_value || 0),
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

  return (
    <div className="personal-finance-container">
      <header className="page-header">
        <div>
          <h1>Financeiro Pessoal</h1>
          <p>Indicadores privados da sua vida financeira, separados do caixa do trabalho.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="personal-summary">
        <div className="summary-card">
          <span>Saldo em bancos</span>
          <strong>{formatCurrency(dashboard?.bank_balance)}</strong>
        </div>
        <div className="summary-card debt">
          <span>Divida total</span>
          <strong>{formatCurrency(dashboard?.total_debt)}</strong>
        </div>
        <div className="summary-card card-bill">
          <span>Fatura atual</span>
          <strong>{formatCurrency(dashboard?.current_card_bill)}</strong>
        </div>
        <div className="summary-card fixed">
          <span>Parcelas fixas</span>
          <strong>{formatCurrency(dashboard?.fixed_debts_month)}</strong>
        </div>
      </section>

      <div className="personal-grid">
        <section className="panel">
          <h2>Atualizar indicadores</h2>
          <form onSubmit={handleSaveStatus}>
            <label>Saldo total em bancos</label>
            <input type="number" step="0.01" value={statusForm.total_bank_balance} onChange={e => setStatusForm({ ...statusForm, total_bank_balance: e.target.value })} />
            <label>Divida total</label>
            <input type="number" step="0.01" value={statusForm.total_debt} onChange={e => setStatusForm({ ...statusForm, total_debt: e.target.value })} />
            <label>Fatura do cartao</label>
            <input type="number" step="0.01" value={statusForm.credit_card_bill} onChange={e => setStatusForm({ ...statusForm, credit_card_bill: e.target.value })} />
            <button type="submit">Salvar indicadores</button>
          </form>
        </section>

        <section className="panel">
          <h2>Nova renegociacao</h2>
          <form onSubmit={handleCreateDebt}>
            <label>Descricao</label>
            <input value={debtForm.description} onChange={e => setDebtForm({ ...debtForm, description: e.target.value })} required />
            <label>Valor da parcela</label>
            <input type="number" step="0.01" value={debtForm.installment_value} onChange={e => setDebtForm({ ...debtForm, installment_value: e.target.value })} required />
            <label>Total de parcelas</label>
            <input type="number" value={debtForm.total_installments} onChange={e => setDebtForm({ ...debtForm, total_installments: e.target.value })} />
            <label>Inicio</label>
            <input type="date" value={debtForm.start_date} onChange={e => setDebtForm({ ...debtForm, start_date: e.target.value })} required />
            <button type="submit">Adicionar renegociacao</button>
          </form>
        </section>
      </div>

      <section className="renegotiations-panel">
        <h2>Renegociacoes ativas</h2>
        <div className="renegotiations-list">
          {renegotiations.map(item => (
            <article key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <span>Inicio em {new Date(item.start_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
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
