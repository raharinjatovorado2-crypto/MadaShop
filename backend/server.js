const express = require("express");
const path = require("path");
const cors = require("cors");
const Database = require("better-sqlite3");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();

/*
============================================================
   PORT
============================================================
   - En local: 3000
   - En production: le hosting fournit process.env.PORT
============================================================
*/

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

const db = new Database(
    path.join(__dirname, "madashop.db")
);


/* ============================================================
   MIDDLEWARE
============================================================ */

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));


/* ============================================================
   CONSTANTS
============================================================ */

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


/* ============================================================
   ORDER STATUS TRANSITIONS
============================================================ */

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


/* ============================================================
   DATABASE HELPERS
============================================================ */

function columnExists(
    tableName,
    columnName
) {

    const columns = db
        .prepare(
            `PRAGMA table_info(${tableName})`
        )
        .all();

    return columns.some(
        (column) =>
            column.name === columnName
    );
}


function addColumnIfMissing(
    tableName,
    columnName,
    definition
) {

    if (
        !columnExists(
            tableName,
            columnName
        )
    ) {

        db.exec(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${definition}
        `);

        console.log(
            `Added missing column ${tableName}.${columnName}`
        );
    }
}


/* ============================================================
   CREATE TABLES
============================================================ */

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
        seller_name TEXT NOT NULL DEFAULT '',
        shop_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        whatsapp TEXT DEFAULT '',
        address TEXT DEFAULT '',
        logo TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        category TEXT DEFAULT 'Autres',
        price REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        image TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        note TEXT DEFAULT '',
        quantity INTEGER NOT NULL,
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'new',

        payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery',
        payment_status TEXT NOT NULL DEFAULT 'pending',

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

`);


/* ============================================================
   MIGRATIONS
============================================================ */

addColumnIfMissing(
    "users",
    "seller_name",
    "TEXT NOT NULL DEFAULT ''"
);

addColumnIfMissing(
    "shops",
    "seller_name",
    "TEXT NOT NULL DEFAULT ''"
);

addColumnIfMissing(
    "products",
    "category",
    "TEXT DEFAULT 'Autres'"
);

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


/* ============================================================
   REPAIR / BACKFILL DATA
============================================================ */

db.prepare(`
    UPDATE shops
    SET seller_name = (
        SELECT users.seller_name
        FROM users
        WHERE users.id = shops.user_id
    )
    WHERE seller_name IS NULL
       OR seller_name = ''
`).run();


db.prepare(`
    UPDATE products
    SET category = 'Autres'
    WHERE category IS NULL
       OR category = ''
`).run();


db.prepare(`
    UPDATE orders
    SET price = total / quantity
    WHERE price = 0
      AND quantity > 0
      AND total > 0
`).run();


db.prepare(`
    UPDATE orders
    SET total = price * quantity
    WHERE total = 0
      AND price > 0
      AND quantity > 0
`).run();


db.prepare(`
    UPDATE orders
    SET payment_method = 'cash_on_delivery'
    WHERE payment_method IS NULL
       OR payment_method = ''
`).run();


db.prepare(`
    UPDATE orders
    SET payment_status = 'pending'
    WHERE payment_status IS NULL
       OR payment_status = ''
`).run();


/* ============================================================
   VALIDATION HELPERS
============================================================ */

function isValidCategory(category) {

    return PRODUCT_CATEGORIES.includes(
        category
    );
}


function isValidOrderStatus(status) {

    return ORDER_STATUSES.includes(
        status
    );
}


function isValidPaymentMethod(
    paymentMethod
) {

    return PAYMENT_METHODS.includes(
        paymentMethod
    );
}


function isValidPaymentStatus(
    paymentStatus
) {

    return PAYMENT_STATUSES.includes(
        paymentStatus
    );
}


function normalizePhone(phone) {

    if (
        phone === undefined ||
        phone === null
    ) {

        return "";

    }

    return String(phone)
        .trim()
        .replace(/\s+/g, "")
        .replace(/-/g, "");
}


function phonesMatch(
    phone1,
    phone2
) {

    return normalizePhone(phone1) ===
        normalizePhone(phone2);
}


function statusReservesStock(status) {

    return STOCK_RESERVED_STATUSES.includes(
        status
    );
}


function isAllowedOrderTransition(
    currentStatus,
    newStatus
) {

    const allowedTransitions =
        ORDER_STATUS_TRANSITIONS[
            currentStatus
        ] || [];

    return allowedTransitions.includes(
        newStatus
    );
}


/* ============================================================
   HOME / STATIC FILES
============================================================ */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "..",
                "index.html"
            )
        );

    }
);


app.use(
    express.static(
        path.join(
            __dirname,
            ".."
        )
    )
);


/* ============================================================
   REGISTER
============================================================ */

app.post(
    "/api/register",
    (req, res) => {

        try {

            /*
            ----------------------------------------------------
               NORMALIZE REGISTER DATA
               This prevents SQLite from receiving undefined
               or unsupported values.
            ----------------------------------------------------
            */

            const sellerName =
                req.body?.sellerName !== undefined &&
                req.body?.sellerName !== null
                    ? String(
                        req.body.sellerName
                    ).trim()
                    : "";

            const shopName =
                req.body?.shopName !== undefined &&
                req.body?.shopName !== null
                    ? String(
                        req.body.shopName
                    ).trim()
                    : "";

            const phone =
                req.body?.phone !== undefined &&
                req.body?.phone !== null
                    ? String(
                        req.body.phone
                    ).trim()
                    : "";

            const email =
                req.body?.email !== undefined &&
                req.body?.email !== null
                    ? String(
                        req.body.email
                    ).trim()
                    : "";

            const password =
                req.body?.password !== undefined &&
                req.body?.password !== null
                    ? String(
                        req.body.password
                    )
                    : "";


            /*
            ----------------------------------------------------
               VALIDATION
            ----------------------------------------------------
            */

            if (
                !sellerName ||
                !shopName ||
                !phone ||
                !email ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Tous les champs sont obligatoires."

                });

            }


            /*
            ----------------------------------------------------
               CHECK EXISTING EMAIL
            ----------------------------------------------------
            */

            const existingUser =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE email = ?
                `).get(
                    email
                );


            if (existingUser) {

                return res.status(409).json({

                    success: false,

                    message:
                        "Cet email est déjà utilisé."

                });

            }


            /*
            ----------------------------------------------------
               CREATE USER + SHOP
            ----------------------------------------------------
            */

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
                            sellerName,
                            shopName,
                            phone,
                            email,
                            password
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
                        userId,
                        sellerName,
                        shopName,
                        "",
                        phone,
                        "",
                        "",
                        ""
                    );


                    return userId;

                });


            /*
            ----------------------------------------------------
               GET CREATED USER
            ----------------------------------------------------
            */

            const user =
                db.prepare(`
                    SELECT
                        id,
                        seller_name,
                        shop_name,
                        phone,
                        email,
                        created_at
                    FROM users
                    WHERE id = ?
                `).get(
                    createUser
                );


            return res.status(201).json({

                success: true,

                message:
                    "Compte créé avec succès.",

                user

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


/* ============================================================
   LOGIN
============================================================ */

app.post(
    "/api/login",
    (req, res) => {

        try {

            const {
                email,
                password
            } = req.body;


            if (
                !email ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Email et mot de passe obligatoires."

                });

            }


            const user =
                db.prepare(`
                    SELECT
                        id,
                        seller_name,
                        shop_name,
                        phone,
                        email,
                        password,
                        created_at
                    FROM users
                    WHERE email = ?
                `).get(
                    email.trim()
                );


            if (
                !user ||
                user.password !== password
            ) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Email ou mot de passe incorrect."

                });

            }


            delete user.password;


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


/* ============================================================
   CREATE PRODUCT
============================================================ */

app.post(
    "/api/products",
    (req, res) => {

        try {

            const {
                userId,
                name,
                description,
                category,
                price,
                stock,
                image
            } = req.body;


            const numericUserId =
                Number(userId);

            const numericPrice =
                Number(price);

            const numericStock =
                Number(stock);


            if (
                !numericUserId ||
                !name ||
                !Number.isFinite(
                    numericPrice
                ) ||
                numericPrice < 0 ||
                !Number.isInteger(
                    numericStock
                ) ||
                numericStock < 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations produit invalides."

                });

            }


            const productCategory =
                category || "Autres";


            if (
                !isValidCategory(
                    productCategory
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Catégorie invalide."

                });

            }


            const result =
                db.prepare(`
                    INSERT INTO products (
                        user_id,
                        name,
                        description,
                        category,
                        price,
                        stock,
                        image
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    numericUserId,
                    name.trim(),
                    description || "",
                    productCategory,
                    numericPrice,
                    numericStock,
                    image || ""
                );


            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    result.lastInsertRowid
                );


            return res.status(201).json({

                success: true,

                message:
                    "Produit créé avec succès.",

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
                    "Erreur lors de la création du produit."

            });

        }

    }
);


/* ============================================================
   GET SELLER PRODUCTS
============================================================ */

app.get(
    "/api/products/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID invalide."

                });

            }


            const products =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    userId
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


/* ============================================================
   GET PUBLIC PRODUCT
============================================================ */

app.get(
    "/api/product/:id",
    (req, res) => {

        try {

            const productId =
                Number(req.params.id);


            if (!productId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Product ID invalide."

                });

            }


            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    productId
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


/* ============================================================
   UPDATE PRODUCT
============================================================ */

app.put(
    "/api/products/:id",
    (req, res) => {

        try {

            const productId =
                Number(req.params.id);


            const {
                userId,
                name,
                description,
                category,
                price,
                stock,
                image
            } = req.body;


            const numericUserId =
                Number(userId);

            const numericPrice =
                Number(price);

            const numericStock =
                Number(stock);


            if (
                !productId ||
                !numericUserId ||
                !name ||
                !Number.isFinite(
                    numericPrice
                ) ||
                numericPrice < 0 ||
                !Number.isInteger(
                    numericStock
                ) ||
                numericStock < 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations produit invalides."

                });

            }


            const productCategory =
                category || "Autres";


            if (
                !isValidCategory(
                    productCategory
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Catégorie invalide."

                });

            }


            const existing =
                db.prepare(`
                    SELECT id
                    FROM products
                    WHERE id = ?
                      AND user_id = ?
                `).get(
                    productId,
                    numericUserId
                );


            if (!existing) {

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
                    category = ?,
                    price = ?,
                    stock = ?,
                    image = ?
                WHERE id = ?
                  AND user_id = ?
            `).run(
                name.trim(),
                description || "",
                productCategory,
                numericPrice,
                numericStock,
                image || "",
                productId,
                numericUserId
            );


            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                `).get(
                    productId
                );


            return res.json({

                success: true,

                message:
                    "Produit mis à jour avec succès.",

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


/* ============================================================
   DELETE PRODUCT
============================================================ */

app.delete(
    "/api/products/:id",
    (req, res) => {

        try {

            const productId =
                Number(req.params.id);

            const userId =
                Number(req.body.userId);


            if (
                !productId ||
                !userId
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations invalides."

                });

            }


            const result =
                db.prepare(`
                    DELETE FROM products
                    WHERE id = ?
                      AND user_id = ?
                `).run(
                    productId,
                    userId
                );


            if (
                result.changes === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Produit introuvable."

                });

            }


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


/* ============================================================
   UPDATE SHOP
============================================================ */

app.put(
    "/api/shop/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);


            const {
                sellerName,
                shopName,
                description,
                phone,
                whatsapp,
                address,
                logo
            } = req.body;


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID invalide."

                });

            }


            const existing =
                db.prepare(`
                    SELECT id
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    userId
                );


            if (!existing) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Boutique introuvable."

                });

            }


            db.prepare(`
                UPDATE shops
                SET
                    seller_name = ?,
                    shop_name = ?,
                    description = ?,
                    phone = ?,
                    whatsapp = ?,
                    address = ?,
                    logo = ?
                WHERE user_id = ?
            `).run(
                sellerName || "",
                shopName || "",
                description || "",
                phone || "",
                whatsapp || "",
                address || "",
                logo || "",
                userId
            );


            db.prepare(`
                UPDATE users
                SET
                    seller_name = ?,
                    shop_name = ?,
                    phone = ?
                WHERE id = ?
            `).run(
                sellerName || "",
                shopName || "",
                phone || "",
                userId
            );


            const shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    userId
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


/* ============================================================
   PUBLIC SHOP
============================================================ */

app.get(
    "/api/public/shop/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);


            const shop =
                db.prepare(`
                    SELECT *
                    FROM shops
                    WHERE user_id = ?
                `).get(
                    userId
                );


            if (!shop) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Boutique introuvable."

                });

            }


            const products =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    userId
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


/* ============================================================
   CREATE ORDER
============================================================ */

app.post(
    "/api/orders",
    (req, res) => {

        try {

            const {
                userId,
                productId,
                customerName,
                phone,
                address,
                note,
                quantity,
                paymentMethod
            } = req.body;


            const numericUserId =
                Number(userId);

            const numericProductId =
                Number(productId);

            const numericQuantity =
                Number(quantity);


            if (
                !numericUserId ||
                !numericProductId ||
                !customerName ||
                !phone ||
                !address ||
                !Number.isInteger(
                    numericQuantity
                ) ||
                numericQuantity <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations de commande invalides."

                });

            }


            const selectedPaymentMethod =
                paymentMethod ||
                "cash_on_delivery";


            if (
                !isValidPaymentMethod(
                    selectedPaymentMethod
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Mode de paiement invalide."

                });

            }


            const product =
                db.prepare(`
                    SELECT *
                    FROM products
                    WHERE id = ?
                      AND user_id = ?
                `).get(
                    numericProductId,
                    numericUserId
                );


            if (!product) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Produit introuvable."

                });

            }


            if (
                product.stock <
                numericQuantity
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Stock insuffisant."

                });

            }


            const total =
                Number(product.price) *
                numericQuantity;


            const createOrderTransaction =
                db.transaction(() => {

                    const stockResult =
                        db.prepare(`
                            UPDATE products
                            SET stock = stock - ?
                            WHERE id = ?
                              AND user_id = ?
                              AND stock >= ?
                        `).run(
                            numericQuantity,
                            numericProductId,
                            numericUserId,
                            numericQuantity
                        );


                    if (
                        stockResult.changes === 0
                    ) {

                        throw new Error(
                            "Stock insuffisant."
                        );

                    }


                    const result =
                        db.prepare(`
                            INSERT INTO orders (
                                user_id,
                                product_id,
                                product_name,
                                price,
                                customer_name,
                                phone,
                                address,
                                note,
                                quantity,
                                total,
                                status,
                                payment_method,
                                payment_status
                            )
                            VALUES (
                                ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?
                            )
                        `).run(
                            numericUserId,
                            numericProductId,
                            product.name,
                            Number(product.price),
                            customerName.trim(),
                            normalizePhone(phone),
                            address.trim(),
                            note || "",
                            numericQuantity,
                            total,
                            "new",
                            selectedPaymentMethod,
                            "pending"
                        );


                    return Number(
                        result.lastInsertRowid
                    );

                });


            const orderId =
                createOrderTransaction();


            const order =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        product_id,
                        product_name,
                        price,
                        customer_name,
                        phone,
                        address,
                        note,
                        quantity,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        created_at
                    FROM orders
                    WHERE id = ?
                `).get(
                    orderId
                );


            broadcastNewOrder(
                numericUserId,
                order
            );


            return res.status(201).json({

                success: true,

                message:
                    "Order created successfully.",

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
                    error.message ||
                    "Erreur lors de la création de la commande."

            });

        }

    }
);


/* ============================================================
   GET SELLER ORDERS
============================================================ */

app.get(
    "/api/orders/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID invalide."

                });

            }


            const orders =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        product_id,
                        product_name,
                        price,
                        customer_name,
                        phone,
                        address,
                        note,
                        quantity,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        created_at
                    FROM orders
                    WHERE user_id = ?
                    ORDER BY id DESC
                `).all(
                    userId
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


/* ============================================================
   PUBLIC ORDER TRACKING
============================================================ */

app.get(
    "/api/order/track/:id",
    (req, res) => {

        try {

            const orderId =
                Number(req.params.id);

            const phone =
                req.query.phone;


            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Numéro de commande invalide."

                });

            }


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Numéro de téléphone obligatoire."

                });

            }


            const order =
                db.prepare(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        price,
                        quantity,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        created_at,
                        phone
                    FROM orders
                    WHERE id = ?
                `).get(
                    orderId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Commande introuvable."

                });

            }


            if (
                !phonesMatch(
                    order.phone,
                    phone
                )
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Les informations ne correspondent pas à cette commande."

                });

            }


            delete order.phone;


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


/* ============================================================
   UPDATE ORDER STATUS
============================================================ */

app.put(
    "/api/orders/:id/status",
    (req, res) => {

        try {

            const orderId =
                Number(req.params.id);

            const {
                userId,
                status
            } = req.body;


            const numericUserId =
                Number(userId);


            if (
                !orderId ||
                !numericUserId ||
                !isValidOrderStatus(status)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations de statut invalides."

                });

            }


            const order =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE id = ?
                      AND user_id = ?
                `).get(
                    orderId,
                    numericUserId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Commande introuvable."

                });

            }


            if (
                order.status === status
            ) {

                return res.json({

                    success: true,

                    message:
                        "Le statut est déjà à jour.",

                    order

                });

            }


            if (
                !isAllowedOrderTransition(
                    order.status,
                    status
                )
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        `Transition de statut interdite : ${order.status} → ${status}.`

                });

            }


            const oldReservesStock =
                statusReservesStock(
                    order.status
                );

            const newReservesStock =
                statusReservesStock(
                    status
                );


            const updateOrderTransaction =
                db.transaction(() => {

                    if (
                        oldReservesStock &&
                        !newReservesStock
                    ) {

                        const stockResult =
                            db.prepare(`
                                UPDATE products
                                SET stock = stock + ?
                                WHERE id = ?
                                  AND user_id = ?
                            `).run(
                                order.quantity,
                                order.product_id,
                                numericUserId
                            );


                        if (
                            stockResult.changes === 0
                        ) {

                            throw new Error(
                                "Produit introuvable pour restaurer le stock."
                            );

                        }

                    }


                    if (
                        !oldReservesStock &&
                        newReservesStock
                    ) {

                        const product =
                            db.prepare(`
                                SELECT *
                                FROM products
                                WHERE id = ?
                                  AND user_id = ?
                            `).get(
                                order.product_id,
                                numericUserId
                            );


                        if (!product) {

                            throw new Error(
                                "Produit introuvable."
                            );

                        }


                        if (
                            product.stock <
                            order.quantity
                        ) {

                            throw new Error(
                                "Stock insuffisant pour réactiver cette commande."
                            );

                        }


                        const stockResult =
                            db.prepare(`
                                UPDATE products
                                SET stock = stock - ?
                                WHERE id = ?
                                  AND user_id = ?
                                  AND stock >= ?
                            `).run(
                                order.quantity,
                                order.product_id,
                                numericUserId,
                                order.quantity
                            );


                        if (
                            stockResult.changes === 0
                        ) {

                            throw new Error(
                                "Stock insuffisant."
                            );

                        }

                    }


                    const updateResult =
                        db.prepare(`
                            UPDATE orders
                            SET status = ?
                            WHERE id = ?
                              AND user_id = ?
                        `).run(
                            status,
                            orderId,
                            numericUserId
                        );


                    if (
                        updateResult.changes === 0
                    ) {

                        throw new Error(
                            "La commande n'a pas pu être mise à jour."
                        );

                    }

                });


            updateOrderTransaction();


            const updatedOrder =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        product_id,
                        product_name,
                        price,
                        customer_name,
                        phone,
                        address,
                        note,
                        quantity,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        created_at
                    FROM orders
                    WHERE id = ?
                `).get(
                    orderId
                );


            broadcastOrderStatusUpdated(
                numericUserId,
                updatedOrder
            );


            return res.json({

                success: true,

                message:
                    "Order status updated successfully.",

                order:
                    updatedOrder

            });


        } catch (error) {

            console.error(
                "Update order status error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Erreur lors de la mise à jour du statut."

            });

        }

    }
);


/* ============================================================
   UPDATE PAYMENT STATUS
============================================================ */

app.put(
    "/api/orders/:id/payment",
    (req, res) => {

        try {

            const orderId =
                Number(req.params.id);

            const {
                userId,
                paymentStatus
            } = req.body;


            const numericUserId =
                Number(userId);


            if (
                !orderId ||
                !numericUserId
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Informations invalides."

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
                      AND user_id = ?
                `).get(
                    orderId,
                    numericUserId
                );


            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Commande introuvable."

                });

            }


            if (
                order.payment_status ===
                paymentStatus
            ) {

                return res.json({

                    success: true,

                    message:
                        "Le statut de paiement est déjà à jour.",

                    order

                });

            }


            db.prepare(`
                UPDATE orders
                SET payment_status = ?
                WHERE id = ?
                  AND user_id = ?
            `).run(
                paymentStatus,
                orderId,
                numericUserId
            );


            const updatedOrder =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        product_id,
                        product_name,
                        price,
                        customer_name,
                        phone,
                        address,
                        note,
                        quantity,
                        total,
                        status,
                        payment_method,
                        payment_status,
                        created_at
                    FROM orders
                    WHERE id = ?
                `).get(
                    orderId
                );


            broadcastPaymentStatusUpdated(
                numericUserId,
                updatedOrder
            );


            return res.json({

                success: true,

                message:
                    "Payment status updated successfully.",

                order:
                    updatedOrder

            });


        } catch (error) {

            console.error(
                "Update payment status error:",
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


/* ============================================================
   ADVANCED DASHBOARD
============================================================ */

app.get(
    "/api/dashboard/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);


            if (
                !userId ||
                !Number.isInteger(userId) ||
                userId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID invalide."

                });

            }


            /* ==================================================
               BASIC PRODUCT STATISTICS
            ================================================== */

            const productsStats =
                db.prepare(`
                    SELECT

                        COUNT(*) AS totalProducts,

                        COALESCE(
                            SUM(stock),
                            0
                        ) AS totalStock,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN stock <= 5
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS lowStockProducts,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN stock = 0
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS outOfStockProducts

                    FROM products

                    WHERE user_id = ?
                `)
                .get(userId);


            /* ==================================================
               ORDER STATISTICS
            ================================================== */

            const orderStats =
                db.prepare(`
                    SELECT

                        COUNT(*) AS totalOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'new'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS newOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status IN (
                                        'accepted',
                                        'processing'
                                    )
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS processingOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS completedOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'cancelled'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS cancelledOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'rejected'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS rejectedOrders

                    FROM orders

                    WHERE user_id = ?
                `)
                .get(userId);


            /* ==================================================
               SALES

               Sales = completed orders only
            ================================================== */

            const salesStats =
                db.prepare(`
                    SELECT

                        COALESCE(
                            SUM(total),
                            0
                        ) AS sales,

                        COALESCE(
                            SUM(quantity),
                            0
                        ) AS itemsSold

                    FROM orders

                    WHERE user_id = ?

                      AND status = 'completed'
                `)
                .get(userId);


            /* ==================================================
               PAYMENT STATISTICS
            ================================================== */

            const paymentStats =
                db.prepare(`
                    SELECT

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN payment_status = 'paid'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS paidOrders,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN payment_status = 'pending'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS pendingPayments,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN payment_status = 'failed'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS failedPayments,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN payment_status = 'paid'
                                    THEN total
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS paidAmount

                    FROM orders

                    WHERE user_id = ?
                `)
                .get(userId);


            /* ==================================================
               LOW STOCK PRODUCTS
            ================================================== */

            const lowStockProducts =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        category,
                        price,
                        stock,
                        image

                    FROM products

                    WHERE user_id = ?

                      AND stock <= 5

                    ORDER BY
                        stock ASC,
                        id DESC

                    LIMIT 10
                `)
                .all(userId);


            /* ==================================================
               TOP PRODUCTS

               Calculated from completed orders.
            ================================================== */

            const topProducts =
                db.prepare(`
                    SELECT

                        product_id AS productId,

                        product_name AS productName,

                        COALESCE(
                            SUM(quantity),
                            0
                        ) AS quantitySold,

                        COALESCE(
                            SUM(total),
                            0
                        ) AS revenue

                    FROM orders

                    WHERE user_id = ?

                      AND status = 'completed'

                    GROUP BY
                        product_id,
                        product_name

                    ORDER BY
                        quantitySold DESC,
                        revenue DESC

                    LIMIT 10
                `)
                .all(userId);


            /* ==================================================
               RECENT ORDERS
            ================================================== */

            const recentOrders =
                db.prepare(`
                    SELECT

                        id,
                        product_id AS productId,
                        product_name AS productName,
                        customer_name AS customerName,
                        quantity,
                        price,
                        total,
                        status,
                        payment_method AS paymentMethod,
                        payment_status AS paymentStatus,
                        created_at AS createdAt

                    FROM orders

                    WHERE user_id = ?

                    ORDER BY
                        id DESC

                    LIMIT 8
                `)
                .all(userId);


            /* ==================================================
               SALES LAST 7 DAYS
            ================================================== */

            const salesLast7Days =
                db.prepare(`
                    SELECT

                        date(created_at) AS date,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN total
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS sales,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN quantity
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS itemsSold,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS orders

                    FROM orders

                    WHERE user_id = ?

                      AND date(
                          created_at
                      ) >= date(
                          'now',
                          '-6 days'
                      )

                    GROUP BY
                        date(created_at)

                    ORDER BY
                        date ASC
                `)
                .all(userId);


            /* ==================================================
               TODAY SALES
            ================================================== */

            const todayStats =
                db.prepare(`
                    SELECT

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN total
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS sales,

                        COALESCE(
                            SUM(
                                CASE
                                    WHEN status = 'completed'
                                    THEN 1
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS orders

                    FROM orders

                    WHERE user_id = ?

                      AND date(
                          created_at
                      ) = date('now')
                `)
                .get(userId);


            /* ==================================================
               RETURN DASHBOARD
            ================================================== */

            return res.json({

                success: true,

                stats: {

                    products:
                        Number(
                            productsStats.totalProducts || 0
                        ),

                    orders:
                        Number(
                            orderStats.totalOrders || 0
                        ),

                    newOrders:
                        Number(
                            orderStats.newOrders || 0
                        ),

                    processingOrders:
                        Number(
                            orderStats.processingOrders || 0
                        ),

                    completedOrders:
                        Number(
                            orderStats.completedOrders || 0
                        ),

                    cancelledOrders:
                        Number(
                            orderStats.cancelledOrders || 0
                        ),

                    rejectedOrders:
                        Number(
                            orderStats.rejectedOrders || 0
                        ),

                    sales:
                        Number(
                            salesStats.sales || 0
                        ),

                    itemsSold:
                        Number(
                            salesStats.itemsSold || 0
                        ),

                    totalStock:
                        Number(
                            productsStats.totalStock || 0
                        ),

                    lowStockProducts:
                        Number(
                            productsStats.lowStockProducts || 0
                        ),

                    outOfStockProducts:
                        Number(
                            productsStats.outOfStockProducts || 0
                        ),

                    paidOrders:
                        Number(
                            paymentStats.paidOrders || 0
                        ),

                    pendingPayments:
                        Number(
                            paymentStats.pendingPayments || 0
                        ),

                    failedPayments:
                        Number(
                            paymentStats.failedPayments || 0
                        ),

                    paidAmount:
                        Number(
                            paymentStats.paidAmount || 0
                        ),

                    todaySales:
                        Number(
                            todayStats.sales || 0
                        ),

                    todayOrders:
                        Number(
                            todayStats.orders || 0
                        )

                },

                lowStockProducts,

                topProducts,

                recentOrders,

                salesLast7Days

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


/* ============================================================
   WEBSOCKET
============================================================ */

const wss =
    new WebSocketServer({
        noServer: true
    });


const clients =
    new Map();


wss.on(
    "connection",
    (ws, userId) => {

        const key =
            String(userId);


        clients.set(
            key,
            ws
        );


        console.log(
            `WebSocket client connected for user ${userId}.`
        );


        ws.send(
            JSON.stringify({

                type:
                    "connection",

                message:
                    "Connected successfully."

            })
        );


        ws.on(
            "close",
            () => {

                if (
                    clients.get(key) === ws
                ) {

                    clients.delete(key);

                }


                console.log(
                    `WebSocket client disconnected for user ${userId}.`
                );

            }
        );


        ws.on(
            "error",
            (error) => {

                console.error(
                    `WebSocket error for user ${userId}:`,
                    error
                );

            }
        );

    }
);


/* ============================================================
   BROADCAST NEW ORDER
============================================================ */

function broadcastNewOrder(
    userId,
    order
) {

    const ws =
        clients.get(
            String(userId)
        );


    if (!ws) {
        return;
    }


    if (
        ws.readyState !== 1
    ) {
        return;
    }


    const safeOrder = {

        id:
            order.id,

        product_id:
            order.product_id,

        product_name:
            order.product_name,

        quantity:
            order.quantity,

        total:
            order.total,

        customer_name:
            order.customer_name,

        status:
            order.status,

        payment_method:
            order.payment_method,

        payment_status:
            order.payment_status,

        created_at:
            order.created_at

    };


    ws.send(
        JSON.stringify({

            type:
                "new_order",

            order:
                safeOrder

        })
    );


    console.log(
        `New order broadcasted: #${order.id} for user ${userId}`
    );

}


/* ============================================================
   BROADCAST ORDER STATUS UPDATED
============================================================ */

function broadcastOrderStatusUpdated(
    userId,
    order
) {

    const ws =
        clients.get(
            String(userId)
        );


    if (!ws) {
        return;
    }


    if (
        ws.readyState !== 1
    ) {
        return;
    }


    const safeOrder = {

        id:
            order.id,

        product_id:
            order.product_id,

        product_name:
            order.product_name,

        quantity:
            order.quantity,

        total:
            order.total,

        status:
            order.status,

        payment_method:
            order.payment_method,

        payment_status:
            order.payment_status,

        created_at:
            order.created_at

    };


    ws.send(
        JSON.stringify({

            type:
                "order_status_updated",

            order:
                safeOrder

        })
    );


    console.log(
        `Order status update broadcasted: order #${order.id} -> ${order.status} for user ${userId}`
    );

}


/* ============================================================
   BROADCAST PAYMENT STATUS UPDATED
============================================================ */

function broadcastPaymentStatusUpdated(
    userId,
    order
) {

    const ws =
        clients.get(
            String(userId)
        );


    if (!ws) {
        return;
    }


    if (
        ws.readyState !== 1
    ) {
        return;
    }


    const safeOrder = {

        id:
            order.id,

        product_id:
            order.product_id,

        product_name:
            order.product_name,

        quantity:
            order.quantity,

        total:
            order.total,

        status:
            order.status,

        payment_method:
            order.payment_method,

        payment_status:
            order.payment_status,

        created_at:
            order.created_at

    };


    ws.send(
        JSON.stringify({

            type:
                "payment_status_updated",

            order:
                safeOrder

        })
    );


    console.log(
        `Payment status update broadcasted: order #${order.id} -> ${order.payment_status} for user ${userId}`
    );

}


/* ============================================================
   WEBSOCKET UPGRADE
============================================================ */

server.on(
    "upgrade",
    (request, socket, head) => {

        try {

            const url =
                new URL(
                    request.url,
                    `http://${request.headers.host}`
                );


            if (
                url.pathname !== "/"
            ) {

                socket.destroy();

                return;

            }


            const userId =
                url.searchParams.get(
                    "userId"
                );


            if (!userId) {

                socket.destroy();

                return;

            }


            wss.handleUpgrade(
                request,
                socket,
                head,
                (ws) => {

                    wss.emit(
                        "connection",
                        ws,
                        userId
                    );

                }
            );

        } catch (error) {

            console.error(
                "WebSocket upgrade error:",
                error
            );

            socket.destroy();

        }

    }
);


/* ============================================================
   404 API
============================================================ */

app.use(
    "/api",
    (req, res) => {

        return res.status(404).json({

            success: false,

            message:
                "API endpoint not found."

        });

    }
);


/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
    (error, req, res, next) => {

        console.error(
            "Server error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Internal server error."

        });

    }
);


/* ============================================================
   START SERVER
============================================================ */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `MadaShop server running on port ${PORT}`
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
