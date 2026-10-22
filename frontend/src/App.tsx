import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { HomePage } from './pages/HomePage';
import { ShopPage } from './pages/ShopPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CakeStudioPage } from './pages/CakeStudioPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { AccountPage } from './pages/AccountPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminOrderDetailPage } from './pages/admin/AdminOrderDetailPage';
import { AdminPaymentsPage } from './pages/admin/AdminPaymentsPage';
import { AdminInventoryPage } from './pages/admin/AdminInventoryPage';
import { AdminLoyaltyPage } from './pages/admin/AdminLoyaltyPage';
import { ContactPage } from './pages/ContactPage';
import { InfoPage } from './pages/InfoPage';
import { refreshSession } from './lib/session';

/** Volta ao topo em mudanças de rota — foco passa ao conteúdo para teclado/leitor. */
function RouteChangeEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="lc-container lc-page lc-center" style={{ paddingBlock: 'var(--lc-space-16)' }}>
      <hr className="lc-ornament" style={{ marginInline: 'auto' }} />
      <h1>Página não encontrada</h1>
      <p>O endereço que procurou não existe ou mudou.</p>
      <p>
        <Link to="/">Voltar à página inicial</Link>
      </p>
    </div>
  );
}

export function App() {
  // A sessão é cookie do servidor: no arranque pergunta-se quem está autenticado.
  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <BrowserRouter>
      <RouteChangeEffects />
      <a className="lc-skip-link" href="#lc-main">
        Saltar para o conteúdo
      </a>
      <Header />
      <main id="lc-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/loja" element={<ShopPage />} />
          <Route path="/loja/:slug" element={<ProductDetailPage />} />
          <Route path="/cake-studio" element={<CakeStudioPage />} />
          <Route path="/carrinho" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/registar" element={<RegisterPage />} />
          <Route path="/recuperar-palavra-passe" element={<ForgotPasswordPage />} />
          <Route path="/conta" element={<AccountPage />} />
          <Route path="/conta/encomendas" element={<OrdersPage />} />
          <Route path="/conta/encomendas/:number" element={<OrderDetailPage />} />
          <Route path="/conta/perfil" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminOrdersPage />} />
            <Route path="encomendas" element={<AdminOrdersPage />} />
            <Route path="encomendas/:number" element={<AdminOrderDetailPage />} />
            <Route path="pagamentos" element={<AdminPaymentsPage />} />
            <Route path="inventario" element={<AdminInventoryPage />} />
            <Route path="fidelizacao" element={<AdminLoyaltyPage />} />
          </Route>
          <Route path="/fidelizacao" element={<LoyaltyPage />} />
          <Route path="/contactos" element={<ContactPage />} />
          <Route path="/informacoes/*" element={<InfoPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  );
}
