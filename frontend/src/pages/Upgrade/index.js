import React, { useState } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function Upgrade() {
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      // Chama o backend para gerar o link do Stripe
      const response = await api.post('/checkout');
      
      // Redireciona o usuário para a página segura do Stripe
      window.location.href = response.data.url;
    } catch (err) {
      alert("Erro ao iniciar checkout. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="upgrade-container">
      <header>
        <h1>Suba de nível com o Plano PRO</h1>
        <p>Libere todo o potencial da sua gestão.</p>
      </header>

      <div className="plans-comparison">
        <div className="plan-card">
          <h3>Plano Free</h3>
          <ul>
            <li>Até 3 Clientes</li>
            <li>Até 5 Projetos</li>
            <li>Relatórios Básicos</li>
          </ul>
          <button disabled>Plano Atual</button>
        </div>

        <div className="plan-card featured">
          <div className="badge">MAIS POPULAR</div>
          <h3>Plano PRO</h3>
          <ul>
            <li>Clientes Ilimitados</li>
            <li>Projetos Ilimitados</li>
            <li>Financeiro Avançado</li>
            <li>Suporte Prioritário</li>
          </ul>
          <button onClick={handleCheckout} disabled={loading}>
            {loading ? 'Processando...' : 'Quero ser PRO'}
          </button>
        </div>
      </div>
    </div>
  );
}
