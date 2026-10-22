-- =====================================================================
-- LISSCOMPANY — Fase 2: seed de DEMONSTRAÇÃO do catálogo
--
-- ATENÇÃO: os dados abaixo são ILUSTRATIVOS, servem para desenvolver e
-- testar a plataforma, e serão substituídos pelos dados reais fornecidos
-- pela proprietária (ver docs/decisions.md, decisão #1). Os preços não são
-- os definitivos da marca.
-- =====================================================================

INSERT INTO product_category (slug, name, description, display_order) VALUES
    ('bolos-no-pote',    'Bolos no Pote',    'A especialidade da casa: camadas de bolo e recheio em pote.', 1),
    ('caixas-presente',  'Caixas & Presentes', 'Combos e caixas para oferecer.',                            2);

INSERT INTO product (category_id, slug, name, description, base_price, status, is_cake_studio_base)
VALUES (
    (SELECT id FROM product_category WHERE slug = 'bolos-no-pote'),
    'bolo-no-pote-classico',
    'Bolo no Pote Clássico',
    'Monta o teu bolo no pote no Cake Studio: escolhe a massa, os dois recheios e até três extras.',
    2500.00, 'ACTIVE', TRUE
);

INSERT INTO product (category_id, slug, name, description, base_price, status, is_cake_studio_base)
VALUES (
    (SELECT id FROM product_category WHERE slug = 'bolos-no-pote'),
    'bolo-no-pote-premium',
    'Bolo no Pote Premium',
    'Versão premium com camadas generosas e acabamento especial.',
    3500.00, 'ACTIVE', FALSE
);

INSERT INTO product (category_id, slug, name, description, base_price, status, is_cake_studio_base)
VALUES (
    (SELECT id FROM product_category WHERE slug = 'caixas-presente'),
    'caixa-degustacao',
    'Caixa de Degustação',
    'Seleção de vários bolos no pote para partilhar.',
    12000.00, 'ACTIVE', FALSE
);

-- Ingredientes do Cake Studio (massas, recheios e extras)
INSERT INTO ingredient (kind, slug, name, description, price_delta, display_order) VALUES
    ('CAKE_BASE', 'chocolate',       'Chocolate',       'Massa de cacau intensa e húmida.',                 0.00,    1),
    ('CAKE_BASE', 'baunilha',        'Baunilha',        'Massa clássica de baunilha.',                      300.00,  2),
    ('CAKE_BASE', 'red-velvet',      'Red Velvet',      'Massa aveludada com cacau e toque de baunilha.',   500.00,  3),
    ('FILLING',   'ganache-chocolate', 'Ganache de chocolate', 'Ganache cremosa de chocolate negro.',        0.00,    1),
    ('FILLING',   'creme-de-leite',  'Creme de leite',  'Creme leve de leite.',                              0.00,    2),
    ('FILLING',   'morango',         'Morango',         'Recheio de morango.',                              500.00,  3),
    ('FILLING',   'maracuja',        'Maracujá',        'Creme de maracujá.',                               400.00,  4),
    ('EXTRA',     'granulados',      'Granulados',      'Granulados de chocolate.',                         200.00,  1),
    ('EXTRA',     'folha-de-ouro',   'Folha de ouro',   'Decoração com folha de ouro comestível.',         1500.00, 2),
    ('EXTRA',     'mensagem',        'Mensagem personalizada', 'Mensagem escrita à mão no topo do bolo.',  400.00,  3),
    ('EXTRA',     'frutos-vermelhos', 'Frutos vermelhos', 'Frutos vermelhos frescos.',                      900.00,  4),
    ('EXTRA',     'velas',           'Velas',           'Velas de celebração.',                              0.00,    5);
