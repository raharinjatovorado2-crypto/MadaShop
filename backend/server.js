const express = require("express");
const path = require("path");
const cors = require("cors");
const Database = require("better-sqlite3");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

const db = new Database(
    path.join(__dirname, "madashop.db")
);

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb"
    })
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
    express.static(
        path.join(__dirname, "..")
    )
);

/* =========================================================
   CONSTANTS
========================================================= */

const PRODUCT_CATEGORIES = [
    "Mode",
    "Électronique",
    "Beauté",
    "Maison",
    "Alimentation",
    "Autres"
];

const ORDER_STATUSES = [
    "new",
    "accepted",
    "rejected",
    "processing",
    "completed",
    "cancelled"
];

const PAYMENT_METHODS = [
    "cash_on_delivery"
];

const PAYMENT_STATUSES = [
    "pending",
    "paid",
    "failed"
];

const ORDER_STATUS_TRANSITIONS = {
    new: [
        "accepted",
        "rejected",
        "cancelled"
    ],

    accepted: [
        "processing",
        "cancelled"
    ],

    processing: [
        "completed",
        "cancelled"
    ],

    completed: [],

    rejected: [],

    cancelled: [
        "new",
        "accepted",
        "processing"
    ]
};

const STOCK_RESERVED_STATUSES = [
    "new",
    "accepted",
    "processing",
    "completed"
];

/* =========================================================
   DATABASE HELPERS
========================================================= */

function columnExists(tableName, columnName) {
    const columns = db
        .prepare(
            `PRAGMA table_info(${tableName})`
        )
        .all();

    return columns.some(
        column => column.name === columnName
    );
}

function addColumnIfMissing(
    tableName,
    columnName,
    definition
) {
    if (!columnExists(tableName, columnName)) {
        db.exec(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${definition}
        `);

        console.log(
            `Added missing column ${tableName}.${columnName}`
        );
    }
}

/* =========================================================
   CREATE TABLES
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_name TEXT NOT NULL,
        shop_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        seller_name TEXT NOT NULL,
        shop_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        whatsapp TEXT DEFAULT '',
        address TEXT DEFAULT '',
        logo TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        price REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        image TEXT DEFAULT '',
        category TEXT DEFAULT 'Autres',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_address TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'new',
        payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery',
        payment_status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

/* =========================================================
   MIGRATIONS
========================================================= */

/* USERS */

addColumnIfMissing(
    "users",
    "seller_name",
    "TEXT NOT NULL DEFAULT ''"
);

/* SHOPS */

addColumnIfMissing(
    "shops",
    "seller_name",
    "TEXT NOT NULL DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "description",
    "TEXT DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "phone",
    "TEXT DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "whatsapp",
    "TEXT DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "address",
    "TEXT DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "logo",
    "TEXT DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "created_at",
    "DATETIME DEFAULT CURRENT_TIMESTAMP"
);

addColumnIfMissing(
    "shops",
    "updated_at",
    "DATETIME DEFAULT CURRENT_TIMESTAMP"
);

/* PRODUCTS */

addColumnIfMissing(
    "products",
    "category",
    "TEXT DEFAULT 'Autres'"
);

/* ORDERS */

addColumnIfMissing(
    "orders",
    "price",
    "REAL NOT NULL DEFAULT 0"
);

addColumnIfMissing(
    "orders",
    "total",
    "REAL NOT NULL DEFAULT 0"
);

addColumnIfMissing(
    "orders",
    "payment_method",
    "TEXT NOT NULL DEFAULT 'cash_on_delivery'"
);

addColumnIfMissing(
    "orders",
    "payment_status",
    "TEXT NOT NULL DEFAULT 'pending'"
);

/* =========================================================
   DATA REPAIR
========================================================= */

/*
   Repair empty seller_name in shops
*/

db.prepare(`
    UPDATE shops
    SET seller_name = (
        SELECT seller_name
        FROM users
        WHERE users.id = shops.user_id
    )
    WHERE
        (shops.seller_name IS NULL
        OR TRIM(shops.seller_name) = '')
        AND EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = shops.user_id
        )
`).run();

/*
   Repair product category
*/

db.prepare(`
    UPDATE products
    SET category = 'Autres'
    WHERE category IS NULL
       OR TRIM(category) = ''
`).run();

/*
   Repair order price
*/

db.prepare(`
    UPDATE orders
    SET price = (
        SELECT price
        FROM products
        WHERE products.id = orders.product_id
    )
    WHERE
        (price IS NULL OR price = 0)
        AND EXISTS (
            SELECT 1
            FROM products
            WHERE products.id = orders.product_id
        )
`).run();

/*
   Repair order total
*/

db.prepare(`
    UPDATE orders
    SET total = price * quantity
    WHERE total IS NULL
       OR total = 0
`).run();

/*
   Repair payment method
*/

db.prepare(`
    UPDATE orders
    SET payment_method = 'cash_on_delivery'
    WHERE payment_method IS NULL
       OR TRIM(payment_method) = ''
`).run();

/*
   Repair payment status
*/

db.prepare(`
    UPDATE orders
    SET payment_status = 'pending'
    WHERE payment_status IS NULL
       OR TRIM(payment_status) = ''
`).run();

/* =========================================================
   IMPORTANT:
   AUTOMATIC SHOP BACKFILL
========================================================= */

/*
   This creates a shop for every existing user who
   doesn't have a corresponding row in shops.

   Example:

   users:
       id = 10

   shops:
       no row for user_id = 10

   The query creates:

       shops.user_id = 10
*/

try {
    const backfillShopsResult = db.prepare(`
        INSERT INTO shops (
            user_id,
            seller_name,
            shop_name,
            description,
            phone,
            whatsapp,
            address,
            logo
        )
        SELECT
            u.id,
            COALESCE(u.seller_name, ''),
            COALESCE(u.shop_name, ''),
            '',
            COALESCE(u.phone, ''),
            '',
            '',
            ''
        FROM users u
        LEFT JOIN shops s
            ON s.user_id = u.id
        WHERE s.user_id IS NULL
    `).run();

    if (backfillShopsResult.changes > 0) {
        console.log(
            `Backfilled ${backfillShopsResult.changes} missing shop(s).`
        );
    } else {
        console.log(
            "Shop backfill complete. No missing shops found."
        );
    }

} catch (error) {
    console.error(
        "Shop backfill error:",
        error
    );
}

/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

function normalizeText(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value).trim();
}

function normalizeNumber(
    value,
    defaultValue = 0
) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return defaultValue;
    }

    return number;
}

function normalizeInteger(
    value,
    defaultValue = 0
) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return defaultValue;
    }

    return Math.trunc(number);
}

function isValidStatus(status) {
    return ORDER_STATUSES.includes(status);
}

function isValidPaymentStatus(status) {
    return PAYMENT_STATUSES.includes(status);
}

function isValidPaymentMethod(method) {
    return PAYMENT_METHODS.includes(method);
}

function isStockReservedStatus(status) {
    return STOCK_RESERVED_STATUSES.includes(
        status
    );
}

/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/api/register",
    (req, res) => {
        try {
            const sellerName =
                normalizeText(
                    req.body?.sellerName
                );

            const shopName =
                normalizeText(
                    req.body?.shopName
                );

            const phone =
                normalizeText(
                    req.body?.phone
                );

            const email =
                normalizeText(
                    req.body?.email
                ).toLowerCase();

            const password =
                normalizeText(
                    req.body?.password
                );

            if (!sellerName) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Veuillez entrer votre nom."
                });
            }

            if (!shopName) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Veuillez entrer le nom de votre boutique."
                });
            }

            if (!phone) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Veuillez entrer votre numéro de téléphone."
                });
            }

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Veuillez entrer votre email."
                });
            }

            if (!password) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Veuillez entrer votre mot de passe."
                });
            }

            const existingUser =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE email = ?
                `).get(
                    String(email)
                );

            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Cet email est déjà utilisé."
                });
            }

            const createUser =
                db.transaction(() => {

                    const userResult =
                        db.prepare(`
                            INSERT INTO users (
                                seller_name,
                                shop_name,
                                phone,
                                email,
                                password
                            )
                            VALUES (?, ?, ?, ?, ?)
                        `).run(
                            String(sellerName),
                            String(shopName),
                            String(phone),
                            String(email),
                            String(password)
                        );

                    const userId =
                        Number(
                            userResult.lastInsertRowid
                        );

                    db.prepare(`
                        INSERT INTO shops (
                            user_id,
                            seller_name,
                            shop_name,
                            description,
                            phone,
                            whatsapp,
                            address,
                            logo
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        Number(userId),
                        String(sellerName),
                        String(shopName),
                        "",
                        String(phone),
                        "",
                        "",
                        ""
                    );

                    return userId;
                });

            const userId =
                createUser();

            console.log(
                `New user registered: ${userId}`
            );

            return res.json({
                success: true,
                message:
                    "Compte créé avec succès.",
                user: {
                    id: userId,
                    seller_name:
                        sellerName,
                    shop_name:
                        shopName,
                    phone,
                    email
                }
            });

        } catch (error) {
            console.error(
                "Register error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la création du compte."
            });
        }
    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/api/login",
    (req, res) => {
        try {
            const email =
                normalizeText(
                    req.body?.email
                ).toLowerCase();

            const password =
                normalizeText(
                    req.body?.password
                );

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Email et mot de passe requis."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        seller_name,
                        shop_name,
                        phone,
                        email
                    FROM users
                    WHERE email = ?
                      AND password = ?
                `).get(
                    String(email),
                    String(password)
                );

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Email ou mot de passe incorrect."
                });
            }

            /*
               Make sure this user has a shop.
            */

            let shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    Number(user.id)
                );

            if (!shop) {
                db.prepare(`
                    INSERT INTO shops (
                        user_id,
                        seller_name,
                        shop_name,
                        description,
                        phone,
                        whatsapp,
                        address,
                        logo
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    Number(user.id),
                    String(
                        user.seller_name || ""
                    ),
                    String(
                        user.shop_name || ""
                    ),
                    "",
                    String(
                        user.phone || ""
                    ),
                    "",
                    "",
                    ""
                );

                console.log(
                    `Created missing shop during login for user ${user.id}.`
                );
            }

            return res.json({
                success: true,
                message:
                    "Connexion réussie.",
                user
            });

        } catch (error) {
            console.error(
                "Login error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la connexion."
            });
        }
    }
);

/* =========================================================
   CREATE PRODUCT
========================================================= */

app.post(
    "/api/products",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.body?.userId
                );

            const name =
                normalizeText(
                    req.body?.name
                );

            const description =
                normalizeText(
                    req.body?.description
                );

            const price =
                normalizeNumber(
                    req.body?.price
                );

            const stock =
                normalizeInteger(
                    req.body?.stock
                );

            const image =
                normalizeText(
                    req.body?.image
                );

            let category =
                normalizeText(
                    req.body?.category
                );

            if (!category) {
                category = "Autres";
            }

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Nom du produit requis."
                });
            }

            if (price < 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Prix invalide."
                });
            }

            if (stock < 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Stock invalide."
                });
            }

            if (
                !PRODUCT_CATEGORIES.includes(
                    category
                )
            ) {
                category = "Autres";
            }

            const user =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE id = ?
                `).get(
                    Number(userId)
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }

            const result =
                db.prepare(`
                    INSERT INTO products (
                        user_id,
                        name,
                        description,
                        price,
                        stock,
                        image,
                        category
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    Number(userId),
                    String(name),
                    String(description),
                    Number(price),
                    Number(stock),
                    String(image),
                    String(category)
                );

            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    Number(
                        result.lastInsertRowid
                    )
                );

            return res.json({
                success: true,
                message:
                    "Produit ajouté avec succès.",
                product
            });

        } catch (error) {
            console.error(
                "Create product error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de l'ajout du produit."
            });
        }
    }
);

/* =========================================================
   GET PRODUCTS
========================================================= */

app.get(
    "/api/products/:userId",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.params.userId
                );

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            const products =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    Number(userId)
                );

            return res.json({
                success: true,
                products
            });

        } catch (error) {
            console.error(
                "Get products error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du chargement des produits."
            });
        }
    }
);

/* =========================================================
   GET SINGLE PRODUCT
========================================================= */

app.get(
    "/api/product/:id",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Produit introuvable."
                });
            }

            return res.json({
                success: true,
                product
            });

        } catch (error) {
            console.error(
                "Get product error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du chargement du produit."
            });
        }
    }
);

/* =========================================================
   UPDATE PRODUCT
========================================================= */

app.put(
    "/api/products/:id",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            const name =
                normalizeText(
                    req.body?.name
                );

            const description =
                normalizeText(
                    req.body?.description
                );

            const price =
                normalizeNumber(
                    req.body?.price
                );

            const stock =
                normalizeInteger(
                    req.body?.stock
                );

            const image =
                normalizeText(
                    req.body?.image
                );

            let category =
                normalizeText(
                    req.body?.category
                );

            if (!category) {
                category = "Autres";
            }

            if (
                !PRODUCT_CATEGORIES.includes(
                    category
                )
            ) {
                category = "Autres";
            }

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Produit invalide."
                });
            }

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Nom du produit requis."
                });
            }

            if (
                price < 0 ||
                stock < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Prix ou stock invalide."
                });
            }

            const existingProduct =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            if (!existingProduct) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Produit introuvable."
                });
            }

            db.prepare(`
                UPDATE products
                SET
                    name = ?,
                    description = ?,
                    price = ?,
                    stock = ?,
                    image = ?,
                    category = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                String(name),
                String(description),
                Number(price),
                Number(stock),
                String(image),
                String(category),
                Number(id)
            );

            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            return res.json({
                success: true,
                message:
                    "Produit modifié avec succès.",
                product
            });

        } catch (error) {
            console.error(
                "Update product error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la modification du produit."
            });
        }
    }
);

/* =========================================================
   DELETE PRODUCT
========================================================= */

app.delete(
    "/api/products/:id",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Produit introuvable."
                });
            }

            const existingOrder =
                db.prepare(`
                    SELECT id
                    FROM orders
                    WHERE product_id = ?
                    LIMIT 1
                `).get(
                    Number(id)
                );

            if (existingOrder) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Impossible de supprimer ce produit car il possède déjà des commandes."
                });
            }

            db.prepare(`
                DELETE FROM products
                WHERE id = ?
            `).run(
                Number(id)
            );

            return res.json({
                success: true,
                message:
                    "Produit supprimé avec succès."
            });

        } catch (error) {
            console.error(
                "Delete product error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la suppression du produit."
            });
        }
    }
);

/* =========================================================
   UPDATE SHOP
========================================================= */

app.put(
    "/api/shop/:userId",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.params.userId
                );

            const sellerName =
                normalizeText(
                    req.body?.sellerName
                );

            const shopName =
                normalizeText(
                    req.body?.shopName
                );

            const description =
                normalizeText(
                    req.body?.description
                );

            const phone =
                normalizeText(
                    req.body?.phone
                );

            const whatsapp =
                normalizeText(
                    req.body?.whatsapp
                );

            const address =
                normalizeText(
                    req.body?.address
                );

            const logo =
                normalizeText(
                    req.body?.logo
                );

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE id = ?
                `).get(
                    Number(userId)
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }

            const existingShop =
                db.prepare(`
                    SELECT id
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            if (!existingShop) {

                db.prepare(`
                    INSERT INTO shops (
                        user_id,
                        seller_name,
                        shop_name,
                        description,
                        phone,
                        whatsapp,
                        address,
                        logo
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    Number(userId),

                    String(
                        sellerName ||
                        user.seller_name ||
                        ""
                    ),

                    String(
                        shopName ||
                        user.shop_name ||
                        ""
                    ),

                    String(description),

                    String(
                        phone ||
                        user.phone ||
                        ""
                    ),

                    String(whatsapp),

                    String(address),

                    String(logo)
                );

                console.log(
                    `Created missing shop during update for user ${userId}.`
                );

            } else {

                db.prepare(`
                    UPDATE shops
                    SET
                        seller_name = ?,
                        shop_name = ?,
                        description = ?,
                        phone = ?,
                        whatsapp = ?,
                        address = ?,
                        logo = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ?
                `).run(
                    String(sellerName),
                    String(shopName),
                    String(description),
                    String(phone),
                    String(whatsapp),
                    String(address),
                    String(logo),
                    Number(userId)
                );
            }

            /*
               Keep users table synchronized.
            */

            db.prepare(`
                UPDATE users
                SET
                    seller_name = ?,
                    shop_name = ?,
                    phone = ?
                WHERE id = ?
            `).run(
                String(sellerName),
                String(shopName),
                String(phone),
                Number(userId)
            );

            const shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            return res.json({
                success: true,
                message:
                    "Boutique mise à jour avec succès.",
                shop
            });

        } catch (error) {
            console.error(
                "Update shop error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la mise à jour de la boutique."
            });
        }
    }
);

/* =========================================================
   PUBLIC SHOP
========================================================= */

app.get(
    "/api/public/shop/:userId",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.params.userId
                );

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            /*
               Check USER first.
            */

            const user =
                db.prepare(`
                    SELECT
                        id,
                        seller_name,
                        shop_name,
                        phone,
                        email
                    FROM users
                    WHERE id = ?
                `).get(
                    Number(userId)
                );

            if (!user) {
                console.log(
                    `Public shop: user ${userId} not found.`
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }

            /*
               Find shop.
            */

            let shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            /*
               If user exists but shop doesn't,
               create the shop automatically.
            */

            if (!shop) {

                console.log(
                    `Public shop: missing shop detected for user ${userId}.`
                );

                db.prepare(`
                    INSERT INTO shops (
                        user_id,
                        seller_name,
                        shop_name,
                        description,
                        phone,
                        whatsapp,
                        address,
                        logo
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    Number(user.id),

                    String(
                        user.seller_name || ""
                    ),

                    String(
                        user.shop_name || ""
                    ),

                    "",

                    String(
                        user.phone || ""
                    ),

                    "",

                    "",

                    ""
                );

                shop =
                    db.prepare(`
                        SELECT *
                        FROM shops
                        WHERE user_id = ?
                    `).get(
                        Number(userId)
                    );

                console.log(
                    `Public shop: missing shop created for user ${userId}.`
                );
            }

            const products =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    Number(userId)
                );

            return res.json({
                success: true,
                shop,
                products
            });

        } catch (error) {
            console.error(
                "Public shop error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du chargement de la boutique."
            });
        }
    }
);

/* =========================================================
   CREATE ORDER
========================================================= */

app.post(
    "/api/orders",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.body?.userId
                );

            const customerName =
                normalizeText(
                    req.body?.customerName
                );

            const customerPhone =
                normalizeText(
                    req.body?.customerPhone
                );

            const customerAddress =
                normalizeText(
                    req.body?.customerAddress
                );

            const productId =
                normalizeInteger(
                    req.body?.productId
                );

            const quantity =
                normalizeInteger(
                    req.body?.quantity,
                    1
                );

            let paymentMethod =
                normalizeText(
                    req.body?.paymentMethod
                );

            if (!paymentMethod) {
                paymentMethod =
                    "cash_on_delivery";
            }

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Boutique invalide."
                });
            }

            if (!customerName) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Nom du client requis."
                });
            }

            if (!customerPhone) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Téléphone du client requis."
                });
            }

            if (!customerAddress) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Adresse du client requise."
                });
            }

            if (!productId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Produit invalide."
                });
            }

            if (quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Quantité invalide."
                });
            }

            if (
                !isValidPaymentMethod(
                    paymentMethod
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Mode de paiement invalide."
                });
            }

            const createOrder =
                db.transaction(() => {

                    const product =
                        db.prepare(`
                            SELECT *
                            FROM products
                            WHERE id = ?
                              AND user_id = ?
                        `).get(
                            Number(productId),
                            Number(userId)
                        );

                    if (!product) {
                        throw new Error(
                            "PRODUCT_NOT_FOUND"
                        );
                    }

                    if (
                        Number(product.stock) <
                        Number(quantity)
                    ) {
                        throw new Error(
                            "INSUFFICIENT_STOCK"
                        );
                    }

                    const price =
                        Number(
                            product.price
                        );

                    const total =
                        price *
                        quantity;

                    /*
                       Decrease stock immediately
                       when order is created.
                    */

                    db.prepare(`
                        UPDATE products
                        SET
                            stock = stock - ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                          AND stock >= ?
                    `).run(
                        Number(quantity),
                        Number(productId),
                        Number(quantity)
                    );

                    const result =
                        db.prepare(`
                            INSERT INTO orders (
                                user_id,
                                customer_name,
                                customer_phone,
                                customer_address,
                                product_id,
                                product_name,
                                quantity,
                                price,
                                total,
                                status,
                                payment_method,
                                payment_status
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            Number(userId),
                            String(customerName),
                            String(customerPhone),
                            String(customerAddress),
                            Number(productId),
                            String(product.name),
                            Number(quantity),
                            Number(price),
                            Number(total),
                            "new",
                            String(paymentMethod),
                            "pending"
                        );

                    return {
                        orderId:
                            Number(
                                result.lastInsertRowid
                            ),

                        productId:
                            Number(productId),

                        productName:
                            String(product.name),

                        quantity:
                            Number(quantity),

                        price:
                            Number(price),

                        total:
                            Number(total)
                    };
                });

            let createdOrder;

            try {
                createdOrder =
                    createOrder();

            } catch (error) {

                if (
                    error.message ===
                    "PRODUCT_NOT_FOUND"
                ) {
                    return res.status(404).json({
                        success: false,
                        message:
                            "Produit introuvable."
                    });
                }

                if (
                    error.message ===
                    "INSUFFICIENT_STOCK"
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Stock insuffisant."
                    });
                }

                throw error;
            }

            const order =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE id = ?
                `).get(
                    Number(
                        createdOrder.orderId
                    )
                );

            broadcastToUser(
                Number(userId),
                {
                    type: "new_order",
                    order
                }
            );

            return res.json({
                success: true,
                message:
                    "Commande créée avec succès.",
                order
            });

        } catch (error) {
            console.error(
                "Create order error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la création de la commande."
            });
        }
    }
);

/* =========================================================
   GET ORDERS
========================================================= */

app.get(
    "/api/orders/:userId",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.params.userId
                );

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            const orders =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    Number(userId)
                );

            return res.json({
                success: true,
                orders
            });

        } catch (error) {
            console.error(
                "Get orders error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du chargement des commandes."
            });
        }
    }
);

/* =========================================================
   TRACK ORDER
========================================================= */

app.get(
    "/api/order/track/:id",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Commande invalide."
                });
            }

            const order =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Commande introuvable."
                });
            }

            return res.json({
                success: true,
                order
            });

        } catch (error) {
            console.error(
                "Track order error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du suivi de la commande."
            });
        }
    }
);

/* =========================================================
   UPDATE ORDER STATUS
========================================================= */

app.put(
    "/api/orders/:id/status",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            const newStatus =
                normalizeText(
                    req.body?.status
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Commande invalide."
                });
            }

            if (
                !isValidStatus(
                    newStatus
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Statut invalide."
                });
            }

            const updateStatus =
                db.transaction(() => {

                    const order =
                        db.prepare(`
                            SELECT *
                            FROM orders
                            WHERE id = ?
                        `).get(
                            Number(id)
                        );

                    if (!order) {
                        throw new Error(
                            "ORDER_NOT_FOUND"
                        );
                    }

                    const currentStatus =
                        order.status;

                    if (
                        currentStatus ===
                        newStatus
                    ) {
                        return order;
                    }

                    const allowedTransitions =
                        ORDER_STATUS_TRANSITIONS[
                            currentStatus
                        ] || [];

                    if (
                        !allowedTransitions.includes(
                            newStatus
                        )
                    ) {
                        throw new Error(
                            "INVALID_TRANSITION"
                        );
                    }

                    const wasReserved =
                        isStockReservedStatus(
                            currentStatus
                        );

                    const willBeReserved =
                        isStockReservedStatus(
                            newStatus
                        );

                    /*
                       Restore stock when order leaves
                       reserved status.
                    */

                    if (
                        wasReserved &&
                        !willBeReserved
                    ) {
                        db.prepare(`
                            UPDATE products
                            SET
                                stock = stock + ?,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(
                            Number(
                                order.quantity
                            ),
                            Number(
                                order.product_id
                            )
                        );
                    }

                    /*
                       Reserve stock again when a cancelled
                       order is reopened.
                    */

                    if (
                        !wasReserved &&
                        willBeReserved
                    ) {
                        const product =
                            db.prepare(`
                                SELECT *
                                FROM products
                                WHERE id = ?
                            `).get(
                                Number(
                                    order.product_id
                                )
                            );

                        if (!product) {
                            throw new Error(
                                "PRODUCT_NOT_FOUND"
                            );
                        }

                        if (
                            Number(
                                product.stock
                            ) <
                            Number(
                                order.quantity
                            )
                        ) {
                            throw new Error(
                                "INSUFFICIENT_STOCK"
                            );
                        }

                        db.prepare(`
                            UPDATE products
                            SET
                                stock = stock - ?,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                              AND stock >= ?
                        `).run(
                            Number(
                                order.quantity
                            ),
                            Number(
                                order.product_id
                            ),
                            Number(
                                order.quantity
                            )
                        );
                    }

                    db.prepare(`
                        UPDATE orders
                        SET
                            status = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(
                        String(newStatus),
                        Number(id)
                    );

                    return db.prepare(`
                        SELECT *
                        FROM orders
                        WHERE id = ?
                    `).get(
                        Number(id)
                    );
                });

            let order;

            try {
                order =
                    updateStatus();

            } catch (error) {

                if (
                    error.message ===
                    "ORDER_NOT_FOUND"
                ) {
                    return res.status(404).json({
                        success: false,
                        message:
                            "Commande introuvable."
                    });
                }

                if (
                    error.message ===
                    "INVALID_TRANSITION"
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Transition de statut non autorisée."
                    });
                }

                if (
                    error.message ===
                    "PRODUCT_NOT_FOUND"
                ) {
                    return res.status(404).json({
                        success: false,
                        message:
                            "Produit introuvable."
                    });
                }

                if (
                    error.message ===
                    "INSUFFICIENT_STOCK"
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Stock insuffisant pour réactiver cette commande."
                    });
                }

                throw error;
            }

            broadcastToUser(
                Number(order.user_id),
                {
                    type:
                        "order_status_update",
                    order
                }
            );

            return res.json({
                success: true,
                message:
                    "Statut de la commande mis à jour.",
                order
            });

        } catch (error) {
            console.error(
                "Update order status error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la mise à jour du statut."
            });
        }
    }
);

/* =========================================================
   UPDATE PAYMENT
========================================================= */

app.put(
    "/api/orders/:id/payment",
    (req, res) => {
        try {
            const id =
                normalizeInteger(
                    req.params.id
                );

            const paymentStatus =
                normalizeText(
                    req.body?.paymentStatus
                );

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Commande invalide."
                });
            }

            if (
                !isValidPaymentStatus(
                    paymentStatus
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Statut de paiement invalide."
                });
            }

            const order =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Commande introuvable."
                });
            }

            db.prepare(`
                UPDATE orders
                SET
                    payment_status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                String(paymentStatus),
                Number(id)
            );

            const updatedOrder =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE id = ?
                `).get(
                    Number(id)
                );

            broadcastToUser(
                Number(
                    updatedOrder.user_id
                ),
                {
                    type:
                        "payment_update",
                    order:
                        updatedOrder
                }
            );

            return res.json({
                success: true,
                message:
                    "Statut du paiement mis à jour.",
                order:
                    updatedOrder
            });

        } catch (error) {
            console.error(
                "Update payment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors de la mise à jour du paiement."
            });
        }
    }
);

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
    "/api/dashboard/:userId",
    (req, res) => {
        try {
            const userId =
                normalizeInteger(
                    req.params.userId
                );

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Utilisateur invalide."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        seller_name,
                        shop_name,
                        phone,
                        email
                    FROM users
                    WHERE id = ?
                `).get(
                    Number(userId)
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }

            /*
               Make sure shop exists.
            */

            let shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            if (!shop) {
                db.prepare(`
                    INSERT INTO shops (
                        user_id,
                        seller_name,
                        shop_name,
                        description,
                        phone,
                        whatsapp,
                        address,
                        logo
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    Number(user.id),
                    String(
                        user.seller_name || ""
                    ),
                    String(
                        user.shop_name || ""
                    ),
                    "",
                    String(
                        user.phone || ""
                    ),
                    "",
                    "",
                    ""
                );

                shop =
                    db.prepare(`
                        SELECT *
                        FROM shops
                        WHERE user_id = ?
                    `).get(
                        Number(userId)
                    );
            }

            const productCount =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM products
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            const orderCount =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE user_id = ?
                `).get(
                    Number(userId)
                );

            const pendingOrders =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE user_id = ?
                      AND status IN (
                          'new',
                          'accepted',
                          'processing'
                      )
                `).get(
                    Number(userId)
                );

            const completedOrders =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE user_id = ?
                      AND status = 'completed'
                `).get(
                    Number(userId)
                );

            const totalSales =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(total),
                            0
                        ) AS total
                    FROM orders
                    WHERE user_id = ?
                      AND status = 'completed'
                `).get(
                    Number(userId)
                );

            return res.json({
                success: true,
                user,
                shop,
                stats: {
                    productCount:
                        Number(
                            productCount.count
                        ),

                    orderCount:
                        Number(
                            orderCount.count
                        ),

                    pendingOrders:
                        Number(
                            pendingOrders.count
                        ),

                    completedOrders:
                        Number(
                            completedOrders.count
                        ),

                    totalSales:
                        Number(
                            totalSales.total
                        )
                }
            });

        } catch (error) {
            console.error(
                "Dashboard error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Erreur lors du chargement du dashboard."
            });
        }
    }
);

/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
    new WebSocketServer({
        server,
        path: "/"
    });

const clients = new Map();

/*
   clients:
   userId => Set<WebSocket>
*/

wss.on(
    "connection",
    (ws, request) => {
        try {
            const requestUrl =
                new URL(
                    request.url,
                    `http://${request.headers.host || "localhost"}`
                );

            const userId =
                normalizeInteger(
                    requestUrl
                        .searchParams
                        .get("userId")
                );

            if (!userId) {
                ws.close();
                return;
            }

            if (!clients.has(userId)) {
                clients.set(
                    userId,
                    new Set()
                );
            }

            clients
                .get(userId)
                .add(ws);

            ws.send(
                JSON.stringify({
                    type:
                        "connected",
                    message:
                        "WebSocket connected."
                })
            );

            ws.on(
                "close",
                () => {
                    const userClients =
                        clients.get(
                            userId
                        );

                    if (!userClients) {
                        return;
                    }

                    userClients.delete(
                        ws
                    );

                    if (
                        userClients.size ===
                        0
                    ) {
                        clients.delete(
                            userId
                        );
                    }
                }
            );

            ws.on(
                "error",
                error => {
                    console.error(
                        "WebSocket client error:",
                        error
                    );
                }
            );

        } catch (error) {
            console.error(
                "WebSocket connection error:",
                error
            );

            try {
                ws.close();
            } catch (_) {}
        }
    }
);

/* =========================================================
   BROADCAST
========================================================= */

function broadcastToUser(
    userId,
    data
) {
    const userClients =
        clients.get(
            Number(userId)
        );

    if (!userClients) {
        return;
    }

    const message =
        JSON.stringify(data);

    for (
        const client of userClients
    ) {
        if (
            client.readyState === 1
        ) {
            try {
                client.send(
                    message
                );
            } catch (error) {
                console.error(
                    "WebSocket send error:",
                    error
                );
            }
        }
    }
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {
        return res.json({
            success: true,
            message:
                "MadaShop API is running.",
            time:
                new Date().toISOString()
        });
    }
);

/* =========================================================
   API 404
========================================================= */

app.use(
    "/api",
    (req, res) => {
        return res.status(404).json({
            success: false,
            message:
                "API endpoint introuvable."
        });
    }
);

/* =========================================================
   GENERAL ERROR HANDLER
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {
        console.error(
            "Unhandled server error:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        return res.status(500).json({
            success: false,
            message:
                "Une erreur interne est survenue."
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `MadaShop server running on port ${PORT}`
        );

        console.log(
            `Database: ${path.join(
                __dirname,
                "madashop.db"
            )}`
        );

        console.log(
            "Payment method enabled: cash_on_delivery"
        );

        console.log(
            "Payment statuses: pending, paid, failed"
        );

        console.log(
            "Strict order status workflow enabled."
        );

        console.log(
            "Advanced dashboard enabled."
        );
    }
);
