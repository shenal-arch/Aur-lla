CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking ON orders(json_extract(body, '$.tracking'));
CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice ON orders(json_extract(body, '$.invoice'));
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
