import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button, ButtonLink } from './Button';

describe('Button', () => {
  it('dispara onClick quando activado com o teclado/pointeiro', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Adicionar ao carrinho</Button>);

    await user.click(screen.getByRole('button', { name: 'Adicionar ao carrinho' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fica desactivado e com aria-busy quando está a carregar', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        A enviar
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'A enviar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respeita o tipo por omissão (button, não submit)', () => {
    render(<Button>Acção</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('ButtonLink', () => {
  it('renderiza um link navegável (semântica correcta para ir ao Cake Studio)', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/cake-studio" variant="gold">
          Criar bolo
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Criar bolo' });
    expect(link).toHaveAttribute('href', '/cake-studio');
    expect(link.className).toContain('lc-btn--gold');
  });
});
