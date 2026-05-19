import React from 'react';
import { Link } from 'react-router-dom';
import './styles.scss';

export default function NotFound() {
  return (
    <div className="not-found-container">
      <section>
        <h1>Pagina nao encontrada</h1>
        <p>O endereco acessado nao existe ou foi movido.</p>
        <Link to="/dashboard">Voltar ao inicio</Link>
      </section>
    </div>
  );
}
