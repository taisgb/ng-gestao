import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import ModalTransaction from '../../components/ModalTransaction';
import './styles.scss';

export default function Finance() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Estados de resumo
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0 });

  async function loadTransactions() {
    try {
      const response = await api.get('/transactions');
      const data = response.data;
      setTransactions(data);

      // Calcula o resumo simples
      const income = data.filter(t => t.type === 'Receita').reduce((acc, t) => acc + t.amount, 0);
      const expense = data.filter(t => t.type === 'Despesa').reduce((acc, t) => acc + t.amount, 0);
      
      setSummary({
        income,
        expense,
        balance: income - expense
      });
    } catch (err) {
      console.error("Erro ao carregar finanças", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTransactions();
  }, []);

  const formatCurrency = (value) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <div className="finance-container">
      <ModalTransaction 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={loadTransactions} 
      />

      <header className="page-header">
        <h1>Financeiro</h1>
        <button className="btn-add" onClick={() => setIsModalOpen(true)}>
          + Novo Lançamento
        </button>
      </header>

      <section className="summary-cards">
        <div className="card income">
          <span>Entradas</span>
          <strong>{formatCurrency(summary.income)}</strong>
        </div>
        <div className="card expense">
          <span>Saídas</span>
          <strong>{formatCurrency(summary.expense)}</strong>
        </div>
        <div className={`card total ${summary.balance >= 0 ? 'positive' : 'negative'}`}>
          <span>Saldo Geral</span>
          <strong>{formatCurrency(summary.balance)}</strong>
        </div>
      </section>

      {loading ? (
        <p className="loading-msg">Processando lançamentos...</p>
      ) : (
        <div className="transactions-table">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className={t.type.toLowerCase()}>
                  <td>{new Date(t.date).toLocaleDateString('pt-BR')}</td>
                  <td>{t.description}</td>
                  <td>{t.category}</td>
                  <td className="amount-cell">
                    {t.type === 'Despesa' ? '- ' : '+ '}
                    {formatCurrency(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {transactions.length === 0 && (
            <p className="empty-msg">Nenhuma movimentação registrada este mês.</p>
          )}
        </div>
      )}
    </div>
  );
}
