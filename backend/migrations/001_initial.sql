-- Création des tables de base si elles n'existent pas
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100),
    email VARCHAR(255) UNIQUE,
    mot_de_passe VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    delivered_by INTEGER REFERENCES users(id),
    total NUMERIC(10, 2) DEFAULT 0,
    statut VARCHAR(50) DEFAULT 'en_cours',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);