require("dotenv").config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require("pg");
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

// ========================
// POSTGRESQL SESSION STORE
// ========================
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ========================
// DATABASE - CONNECTION
// ========================
console.log("🔍 Checking DATABASE_URL...");
if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set in .env file!");
    process.exit(1);
}
console.log("✅ DATABASE_URL found");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000,
    keepAlive: true
});

let dbConnected = false;

async function connectDB() {
    try {
        await pool.query("SELECT 1");
        dbConnected = true;
        console.log("✅ PostgreSQL Connected");
        return true;
    } catch (err) {
        console.error("❌ PostgreSQL Connection Error:", err.message);
        dbConnected = false;
        return false;
    }
}

// ========================
// CREATE SESSION TABLE
// ========================
async function createSessionTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL,
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            );
        `);
        console.log("✅ Session table ready");
    } catch (err) {
        console.log("⚠️ Session table warning:", err.message);
    }
}

// ========================
// CLEANUP OLD SESSIONS
// ========================
async function cleanupOldSessions() {
    try {
        await pool.query("DELETE FROM session WHERE expire < NOW()");
        console.log("🧹 Old sessions cleaned up");
    } catch (err) {
        console.error("Session cleanup error:", err);
    }
}

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// ========================
// MIDDLEWARE
// ========================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
        ttl: 24 * 60 * 60,
        pruneSessionInterval: 60 * 60
    }),
    secret: process.env.SESSION_SECRET || 'novapay_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'novapay.sid',
    rolling: true,
    genid: function(req) {
        return crypto.randomBytes(32).toString('hex');
    }
}));

app.use(express.static('public'));

// Session cleanup middleware
app.use((req, res, next) => {
    if (req.session && req.session.user && !req.session.user.id) {
        req.session.destroy((err) => {
            if (err) console.error("Session cleanup error:", err);
        });
    }
    next();
});

if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log("➡️", req.method, req.originalUrl);
        const start = Date.now();
        res.on("finish", () => {
            console.log("✅", req.method, req.originalUrl, Date.now() - start + "ms");
        });
        next();
    });
}

// ========================
// GET BASE URL
// ========================
function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}`;
}

// ========================
// FILE UPLOAD
// ========================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// ========================
// CREATE TABLES & INDEXES
// ========================
async function createTables() {
    try {
        console.log("📦 Creating tables...");
        
        const tableQueries = [
            `CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                mobile TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                referral_code TEXT UNIQUE NOT NULL,
                referred_by INTEGER,
                balance DECIMAL DEFAULT 0,
                total_deposit DECIMAL DEFAULT 0,
                total_withdraw DECIMAL DEFAULT 0,
                total_earnings DECIMAL DEFAULT 0,
                bonus_balance DECIMAL DEFAULT 0,
                team_earnings DECIMAL DEFAULT 0,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS plans (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                investment DECIMAL NOT NULL,
                daily_income DECIMAL NOT NULL,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS user_plans (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                plan_id INTEGER NOT NULL REFERENCES plans(id),
                investment DECIMAL NOT NULL,
                daily_income DECIMAL NOT NULL,
                status TEXT DEFAULT 'active',
                last_collected DATE,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount DECIMAL NOT NULL,
                payment_method TEXT,
                account_title TEXT,
                account_number TEXT,
                slip_image TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_at TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS withdraws (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount DECIMAL NOT NULL,
                payment_method TEXT NOT NULL,
                account_holder TEXT NOT NULL,
                account_number TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_at TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                type TEXT NOT NULL,
                amount DECIMAL NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS mining_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                user_plan_id INTEGER NOT NULL REFERENCES user_plans(id),
                amount DECIMAL NOT NULL,
                collected_date DATE DEFAULT CURRENT_DATE
            );`,
            `CREATE TABLE IF NOT EXISTS referral_history (
                id SERIAL PRIMARY KEY,
                referrer_id INTEGER NOT NULL REFERENCES users(id),
                referred_id INTEGER NOT NULL REFERENCES users(id),
                commission DECIMAL NOT NULL,
                deposit_amount DECIMAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS bonuses (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount DECIMAL NOT NULL,
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS support_settings (
                id SERIAL PRIMARY KEY,
                whatsapp_channel TEXT,
                whatsapp_number TEXT,
                telegram_link TEXT,
                email TEXT,
                phone TEXT
            );`,
            `CREATE TABLE IF NOT EXISTS deposit_accounts (
                id SERIAL PRIMARY KEY,
                method TEXT NOT NULL,
                account_title TEXT NOT NULL,
                account_number TEXT NOT NULL,
                status TEXT DEFAULT 'active'
            );`,
            `CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                details TEXT,
                ip TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
            `CREATE TABLE IF NOT EXISTS referral_settings (
                id SERIAL PRIMARY KEY,
                commission_percentage DECIMAL DEFAULT 10
            );`
        ];

        for (const query of tableQueries) {
            try {
                await pool.query(query);
            } catch (err) {
                console.log("⚠️ Table warning:", err.message);
            }
        }
        console.log("✅ Tables ready");

        console.log("📊 Creating indexes...");
        const indexQueries = [
            `CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);`,
            `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);`,
            `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);`,
            `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_user_plans_user ON user_plans(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_withdraws_user ON withdraws(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_mining_user ON mining_history(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_history(referrer_id);`,
            `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);`
        ];

        for (const query of indexQueries) {
            try {
                await pool.query(query);
            } catch (err) {
                // Ignore index errors
            }
        }
        console.log("✅ Indexes ready");

        console.log("📦 Setting up default data...");
        
        const adminResult = await pool.query(`SELECT * FROM admins WHERE username = 'admin'`);
        if (adminResult.rows.length === 0) {
            const hashed = await bcrypt.hash('admin123', 10);
            await pool.query(`INSERT INTO admins (username, password) VALUES ($1, $2)`, ['admin', hashed]);
            console.log("✅ Admin created");
        }

        const plansResult = await pool.query(`SELECT * FROM plans LIMIT 1`);
        if (plansResult.rows.length === 0) {
            const plans = [
                ['🥈 Silver', 1300, 130],
                ['🥇 Gold', 3000, 300],
                ['💎 Platinum', 5000, 500],
                ['👑 Diamond', 10000, 1000],
                ['⚡ Titanium', 20000, 2000],
                ['🏆 Royal', 50000, 5000],
                ['🌟 Elite', 100000, 10000],
                ['💠 Legend', 200000, 20000]
            ];
            for (const p of plans) {
                await pool.query(`INSERT INTO plans (name, investment, daily_income) VALUES ($1, $2, $3)`, p);
            }
            console.log("✅ Plans created");
        }

        const accountsResult = await pool.query(`SELECT * FROM deposit_accounts LIMIT 1`);
        if (accountsResult.rows.length === 0) {
            const accounts = [
                ['EasyPaisa', 'NovaPay International', '1234567890'],
                ['JazzCash', 'NovaPay International', '0987654321'],
                ['Bank Transfer', 'NovaPay Pvt Ltd', 'PK1234567890']
            ];
            for (const a of accounts) {
                await pool.query(`INSERT INTO deposit_accounts (method, account_title, account_number) VALUES ($1, $2, $3)`, a);
            }
            console.log("✅ Deposit accounts created");
        }

        const supportResult = await pool.query(`SELECT * FROM support_settings LIMIT 1`);
        if (supportResult.rows.length === 0) {
            await pool.query(
                `INSERT INTO support_settings (whatsapp_channel, whatsapp_number, telegram_link, email, phone) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['https://whatsapp.com/channel/novapay', '+923001234567', 'https://t.me/novapay', 'support@novapay.com', '+923001234567']
            );
            console.log("✅ Support settings created");
        }

        const referralResult = await pool.query(`SELECT * FROM referral_settings LIMIT 1`);
        if (referralResult.rows.length === 0) {
            await pool.query(`INSERT INTO referral_settings (commission_percentage) VALUES (10)`);
            console.log("✅ Referral settings created");
        }

        console.log("✅ All setup complete!");
        return true;

    } catch (err) {
        console.log("❌ Error in setup:", err.message);
        return false;
    }
}

// ========================
// HELPER FUNCTIONS
// ========================
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Updated isAuthenticated middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user && req.session.user.id) {
        return next();
    }
    // Clear any invalid session
    req.session.destroy((err) => {
        if (err) console.error("Session destroy error:", err);
        res.redirect('/login');
    });
}

// Session validation middleware
async function validateSession(req, res, next) {
    if (req.session && req.session.user && req.session.user.id) {
        try {
            const result = await pool.query(
                "SELECT id, username, mobile, balance, status FROM users WHERE id = $1",
                [req.session.user.id]
            );
            
            if (result.rows.length === 0 || result.rows[0].status === 'suspended') {
                req.session.destroy((err) => {
                    if (err) console.error("Session destroy error:", err);
                    return res.redirect('/login');
                });
                return;
            }
            
            req.session.user.balance = result.rows[0].balance;
            req.session.user.username = result.rows[0].username;
            req.session.user.status = result.rows[0].status;
            
        } catch (err) {
            console.error("Session validation error:", err);
            return res.redirect('/login');
        }
    }
    next();
}

function isAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    res.redirect('/admin/login');
}

function getDateOnly() {
    return new Date().toISOString().split('T')[0];
}

async function logActivity(userId, action, details, ip) {
    try {
        await pool.query(
            `INSERT INTO activity_logs (user_id, action, details, ip)
             VALUES ($1, $2, $3, $4)`,
            [userId, action, details, ip || "127.0.0.1"]
        );
    } catch (err) {
        console.error("Activity Log Error:", err.message);
    }
}

// ========================
// VIEWS SETUP
// ========================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const dirs = ['./views', './views/admin', './public/uploads'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========================
// AUTH ROUTES
// ========================
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return req.session.destroy((err) => {
            if (err) console.error("Session destroy error:", err);
            res.clearCookie('novapay.sid');
            res.redirect('/login');
        });
    }
    res.render('login', { error: null, success: req.query.success || null });
});
// FIXED: Login route with proper session handling
app.post('/login', async (req, res) => {
    try {
        const { mobile, password } = req.body;

        if (!mobile || !password) {
            return res.render('login', { error: 'Please fill all fields' });
        }

        const result = await pool.query("SELECT * FROM users WHERE mobile = $1", [mobile]);
        const user = result.rows[0];

        if (!user) {
            return res.render('login', { error: 'Invalid mobile or password' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.render('login', { error: 'Invalid mobile or password' });
        }

        if (user.status === 'suspended') {
            return res.render('login', { error: 'Account suspended. Contact support.' });
        }

        // ✅ FIX: regenerate() se ek naya, unique session ID milta hai
        // isse purane/kisi doosre user ke session se koi mix-up nahi hota
        req.session.regenerate((err) => {
            if (err) {
                console.error("❌ Session regenerate error:", err);
                return res.render('login', { error: 'Login failed. Please try again.' });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                mobile: user.mobile,
                balance: user.balance
            };

            req.session.save(async (saveErr) => {
                if (saveErr) {
                    console.error("❌ Session save error:", saveErr);
                    return res.render('login', { error: 'Login failed. Please try again.' });
                }
                console.log("✅ New session created for user:", user.username);
                await logActivity(user.id, 'login', 'User logged in', req.ip);
                res.redirect('/dashboard');
            });
        });

    } catch (err) {
        console.error("❌ Login error:", err);
        res.render('login', { error: 'Server Error' });
    }
});

app.get('/register', (req, res) => {
    if (req.session.user) {
        return req.session.destroy((err) => {
            if (err) console.error("Session destroy error:", err);
            res.clearCookie('novapay.sid');
            res.render('register', { error: null, referral: req.query.ref || '' });
        });
    }
    res.render('register', { error: null, referral: req.query.ref || '' });
});

// FIXED: Registration route
app.post('/register', async (req, res) => {
    try {
        const { username, mobile, password, confirm_password, referral_code } = req.body;

        if (!username || !mobile || !password || !confirm_password) {
            return res.render('register', { 
                error: 'Please fill all required fields', 
                referral: referral_code || '' 
            });
        }

        if (password !== confirm_password) {
            return res.render('register', { 
                error: 'Passwords do not match', 
                referral: referral_code || '' 
            });
        }

        if (password.length !== 8) {
            return res.render('register', { 
                error: 'Password must be exactly 8 digits', 
                referral: referral_code || '' 
            });
        }

        const existingResult = await pool.query(
            "SELECT * FROM users WHERE username = $1 OR mobile = $2",
            [username, mobile]
        );

        if (existingResult.rows.length > 0) {
            return res.render('register', { 
                error: 'Username or mobile already exists', 
                referral: referral_code || '' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const refCode = generateReferralCode();
        let referredBy = null;

        if (referral_code) {
            const referrerResult = await pool.query(
                "SELECT id FROM users WHERE referral_code = $1",
                [referral_code]
            );
            if (referrerResult.rows.length > 0) {
                referredBy = referrerResult.rows[0].id;
            }
        }

        const insertResult = await pool.query(
            `INSERT INTO users (username, mobile, password, referral_code, referred_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [username, mobile, hashedPassword, refCode, referredBy]
        );

        const userId = insertResult.rows[0].id;
        await logActivity(userId, "register", "User registered", req.ip);
        
        // Destroy any existing session before redirecting to login
        req.session.destroy((err) => {
            if (err) console.error("Session destroy error:", err);
            res.redirect("/login?success=Registration successful! Please login.");
        });

    } catch (error) {
        console.error("❌ Registration error:", error);
        res.render("register", { 
            error: "Registration failed. Please try again.", 
            referral: req.body.referral_code || "" 
        });
    }
});

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { error: null, success: null });
});

app.post('/forgot-password', async (req, res) => {
    const { mobile, new_password, confirm_password } = req.body;

    if (!mobile || !new_password || !confirm_password) {
        return res.render('forgot-password', { error: 'Please fill all fields', success: null });
    }

    if (new_password !== confirm_password) {
        return res.render('forgot-password', { error: 'Passwords do not match', success: null });
    }

    if (new_password.length !== 8) {
        return res.render('forgot-password', { error: 'Password must be exactly 8 digits', success: null });
    }

    try {
        const userResult = await pool.query(`SELECT * FROM users WHERE mobile = $1`, [mobile]);
        if (userResult.rows.length === 0) {
            return res.render('forgot-password', { error: 'Mobile number not found', success: null });
        }

        const user = userResult.rows[0];
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashedPassword, user.id]);
        await logActivity(user.id, 'password_reset', 'Password reset via forgot password', req.ip);
        res.render('forgot-password', { error: null, success: 'Password updated successfully! Please login.' });

    } catch (err) {
        console.error(err);
        res.render('forgot-password', { error: 'Failed to update password', success: null });
    }
});

// FIXED: Logout route
app.get('/logout', async (req, res) => {
    if (req.session && req.session.user) {
        await logActivity(req.session.user.id, 'logout', 'User logged out', req.ip);
    }
    
    req.session.destroy((err) => {
        if (err) console.error("Session destroy error:", err);
        res.clearCookie('novapay.sid');
        res.redirect('/login');
    });
});

// ========================
// DASHBOARD
// ========================
app.get('/dashboard', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;
    const baseUrl = getBaseUrl(req);
    const today = getDateOnly();

    try {
        const userResult = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        
        if (userResult.rows.length === 0) {
            req.session.destroy();
            return res.redirect('/login');
        }

        const user = userResult.rows[0];
        req.session.user.balance = user.balance;

        const [
            userPlansResult,
            notificationsResult,
            accountsResult,
            allPlansResult,
            referralsResult,
            bonusesResult,
            unreadResult
        ] = await Promise.all([
            pool.query(
                `SELECT up.*, p.name as plan_name 
                 FROM user_plans up 
                 JOIN plans p ON up.plan_id = p.id 
                 WHERE up.user_id = $1 AND up.status = 'active'`,
                [userId]
            ),
            pool.query(
                `SELECT * FROM notifications 
                 WHERE user_id = $1 OR user_id IS NULL 
                 ORDER BY created_at DESC LIMIT 10`,
                [userId]
            ),
            pool.query(`SELECT * FROM deposit_accounts WHERE status = 'active'`),
            pool.query(`SELECT * FROM plans WHERE status = 'active'`),
            pool.query(`SELECT * FROM users WHERE referred_by = $1`, [userId]),
            pool.query(`SELECT * FROM bonuses WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT COUNT(*) as unread FROM notifications WHERE user_id = $1 AND is_read = 0`, [userId])
        ]);

        const userPlans = userPlansResult.rows;

        let todayEarnings = 0;

        if (userPlans && userPlans.length > 0) {
            const miningTodayResult = await pool.query(
                `SELECT user_plan_id, amount 
                 FROM mining_history 
                 WHERE user_id = $1 AND collected_date = $2`,
                [userId, today]
            );
            miningTodayResult.rows.forEach(row => {
                todayEarnings += parseFloat(row.amount || 0);
            });
        }

        const todayBonuses = bonusesResult.rows.filter(bonus => {
            const bonusDate = new Date(bonus.created_at).toISOString().split('T')[0];
            return bonusDate === today;
        });
        todayBonuses.forEach(bonus => {
            todayEarnings += parseFloat(bonus.amount || 0);
        });

        const todayReferralsResult = await pool.query(
            `SELECT commission 
             FROM referral_history 
             WHERE referrer_id = $1 AND DATE(created_at) = $2`,
            [userId, today]
        );
        todayReferralsResult.rows.forEach(ref => {
            todayEarnings += parseFloat(ref.commission || 0);
        });

        res.render('dashboard', {
            user: user,
            userPlans: userPlans || [],
            notifications: notificationsResult.rows || [],
            accounts: accountsResult.rows || [],
            allPlans: allPlansResult.rows || [],
            todayEarnings: todayEarnings,
            referralCount: referralsResult.rows.length,
            bonuses: bonusesResult.rows || [],
            unreadCount: unreadResult.rows[0] ? parseInt(unreadResult.rows[0].unread) : 0,
            baseUrl: baseUrl,
            success: req.query.success || null,
            error: req.query.error || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// ========================
// DEPOSIT
// ========================
app.get('/deposit', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [userResult, accountsResult] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(`SELECT * FROM deposit_accounts WHERE status = 'active'`)
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        res.render('deposit', {
            user: userResult.rows[0],
            accounts: accountsResult.rows || [],
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

app.post('/deposit', isAuthenticated, upload.single('slip'), async (req, res) => {
    const { amount, payment_method, account_title, account_number } = req.body;
    const userId = req.session.user.id;
    const slipImage = req.file ? '/uploads/' + req.file.filename : null;

    if (!amount || parseFloat(amount) < 1300) {
        return res.redirect('/deposit?error=Minimum deposit is PKR 1300');
    }

    try {
        await pool.query(
            `INSERT INTO deposits (user_id, amount, payment_method, account_title, account_number, slip_image)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, amount, payment_method, account_title, account_number, slipImage]
        );

        await Promise.all([
            pool.query(
                `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
                [userId, 'Deposit Request', `Your deposit of PKR ${amount} is pending approval.`]
            ),
            logActivity(userId, 'deposit_request', `Deposit request of PKR ${amount} submitted`, req.ip)
        ]);

        res.redirect('/deposit?success=Deposit request submitted successfully!');

    } catch (err) {
        console.error(err);
        res.redirect('/deposit?error=Deposit request failed');
    }
});

// ========================
// WITHDRAW
// ========================
app.get('/withdraw', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const userResult = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        res.render('withdraw', {
            user: userResult.rows[0],
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

app.post('/withdraw', isAuthenticated, async (req, res) => {
    const { amount, payment_method, account_holder, account_number } = req.body;
    const userId = req.session.user.id;

    if (!amount || parseFloat(amount) < 130) {
        return res.redirect('/withdraw?error=Minimum withdraw is PKR 130');
    }

    try {
        const userResult = await pool.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
        if (userResult.rows.length === 0) {
            return res.redirect('/withdraw?error=User not found');
        }

        const user = userResult.rows[0];
        if (parseFloat(user.balance) < parseFloat(amount)) {
            return res.redirect('/withdraw?error=Insufficient balance');
        }

        await pool.query(
            `INSERT INTO withdraws (user_id, amount, payment_method, account_holder, account_number)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, amount, payment_method, account_holder, account_number]
        );

        await Promise.all([
            pool.query(
                `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
                [userId, 'Withdraw Request', `Your withdraw of PKR ${amount} is pending approval.`]
            ),
            logActivity(userId, 'withdraw_request', `Withdraw request of PKR ${amount} submitted`, req.ip)
        ]);

        res.redirect('/withdraw?success=Withdraw request submitted successfully!');

    } catch (err) {
        console.error(err);
        res.redirect('/withdraw?error=Withdraw request failed');
    }
});

// ========================
// MINING
// ========================
app.get('/mining', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [userResult, userPlansResult] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(
                `SELECT up.*, p.name as plan_name 
                 FROM user_plans up 
                 JOIN plans p ON up.plan_id = p.id 
                 WHERE up.user_id = $1 AND up.status = 'active'`,
                [userId]
            )
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        res.render('mining', {
            user: userResult.rows[0],
            userPlans: userPlansResult.rows || [],
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

app.post('/mining/collect', isAuthenticated, async (req, res) => {
    const { plan_id } = req.body;
    const userId = req.session.user.id;
    const today = getDateOnly();

    try {
        const planResult = await pool.query(
            `SELECT * FROM user_plans WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [plan_id, userId]
        );

        if (planResult.rows.length === 0) {
            return res.json({ success: false, message: 'Plan not found' });
        }

        const plan = planResult.rows[0];

        // CHECK: Already collected today?
        const historyResult = await pool.query(
            `SELECT * FROM mining_history WHERE user_plan_id = $1 AND collected_date = $2`,
            [plan_id, today]
        );

        if (historyResult.rows.length > 0) {
            return res.json({ success: false, message: 'Already collected today' });
        }

        // ✅ IMPORTANT: last_collected update karo
        await Promise.all([
            pool.query(
                `INSERT INTO mining_history (user_id, user_plan_id, amount, collected_date)
                 VALUES ($1, $2, $3, $4)`,
                [userId, plan_id, plan.daily_income, today]
            ),
            pool.query(
                `UPDATE users SET balance = balance + $1, total_earnings = total_earnings + $1 WHERE id = $2`,
                [plan.daily_income, userId]
            ),
            // ✅ YEH LINE HONI CHAHIYE
            pool.query(
                `UPDATE user_plans SET last_collected = $1 WHERE id = $2`,
                [today, plan_id]
            ),
            pool.query(
                `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
                [userId, 'Mining Collected', `You collected PKR ${plan.daily_income} from ${plan.plan_name || 'Plan'}`]
            ),
            logActivity(userId, 'mining_collect', `Collected PKR ${plan.daily_income} from ${plan.plan_name}`, req.ip)
        ]);

        const userResult = await pool.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
        req.session.user.balance = userResult.rows[0].balance;

        res.json({
            success: true,
            message: `Collected PKR ${plan.daily_income}`,
            newBalance: userResult.rows[0] ? parseFloat(userResult.rows[0].balance) : 0
        });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Collection failed: ' + err.message });
    }
});




///tempraryyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
// Temporary route to check database - DELETE LATER
// DEBUG: Check user_plans
app.get('/check-plans', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const result = await pool.query(
            `SELECT id, plan_id, user_id, last_collected, status FROM user_plans WHERE user_id = $1`,
            [userId]
        );
        const today = new Date().toISOString().split('T')[0];
        
        let html = `<h2>📊 User Plans</h2>`;
        html += `<p><strong>Today:</strong> ${today}</p>`;
        html += `<table border="1" cellpadding="5">`;
        html += `<tr><th>ID</th><th>Plan</th><th>last_collected</th><th>Status</th><th>Collected Today?</th></tr>`;
        
        result.rows.forEach(plan => {
            const collected = plan.last_collected === today;
            html += `<tr>
                <td>${plan.id}</td>
                <td>${plan.plan_id}</td>
                <td>${plan.last_collected || 'NULL'}</td>
                <td>${plan.status}</td>
                <td>${collected ? '✅ YES' : '❌ NO'}</td>
            </tr>`;
        });
        html += `</table>`;
        html += `<br><a href="/reset-plans">🔄 Reset All Plans (set to yesterday)</a>`;
        res.send(html);
    } catch (err) {
        res.send(`❌ Error: ${err.message}`);
    }
});
// DEBUG - Check plans
app.get('/check-plans', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const result = await pool.query(
            `SELECT id, plan_id, user_id, last_collected, status FROM user_plans WHERE user_id = $1`,
            [userId]
        );
        const today = new Date().toISOString().split('T')[0];
        
        let html = `<h2>📊 User Plans</h2>`;
        html += `<p><strong>Today:</strong> ${today}</p>`;
        html += `<table border="1" cellpadding="5">`;
        html += `<tr><th>ID</th><th>Plan ID</th><th>last_collected</th><th>Status</th><th>Collected Today?</th></tr>`;
        
        result.rows.forEach(plan => {
            // Date ko string mein convert karo
var lastCollectedStr = plan.last_collected ? new Date(plan.last_collected).toISOString().split('T')[0] : null;
var isCollected = lastCollectedStr === today;
            html += `<tr>
                <td>${plan.id}</td>
                <td>${plan.plan_id}</td>
                <td>${plan.last_collected || 'NULL'}</td>
                <td>${plan.status}</td>
                <td>${collected ? '✅ YES' : '❌ NO'}</td>
            </tr>`;
        });
        html += `</table>`;
        html += `<br><a href="/reset-plans">🔄 Reset All Plans</a>`;
        res.send(html);
    } catch (err) {
        res.send(`❌ Error: ${err.message}`);
    }
});







// ========================
// BONUS
// ========================
app.get('/bonus', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [userResult, bonusesResult] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(`SELECT * FROM bonuses WHERE user_id = $1 ORDER BY created_at DESC`, [userId])
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        res.render('bonus', {
            user: userResult.rows[0],
            bonuses: bonusesResult.rows || [],
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// ========================
// NOTIFICATIONS
// ========================
app.get('/notifications', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [userResult, notificationsResult] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(
                `SELECT * FROM notifications 
                 WHERE user_id = $1 OR user_id IS NULL 
                 ORDER BY created_at DESC`,
                [userId]
            )
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        await pool.query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [userId]);

        res.render('notifications', {
            user: userResult.rows[0],
            notifications: notificationsResult.rows || [],
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// ========================
// RECORDS
// ========================
app.get('/records', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;

    try {
        const [
            userResult,
            depositsResult,
            withdrawsResult,
            miningHistoryResult,
            referralHistoryResult,
            bonusesResult,
            purchasedPlansResult,
            transactionsResult
        ] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(`SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM withdraws WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(
                `SELECT mh.*, up.plan_id 
                 FROM mining_history mh 
                 JOIN user_plans up ON mh.user_plan_id = up.id 
                 WHERE mh.user_id = $1 
                 ORDER BY mh.collected_date DESC`,
                [userId]
            ),
            pool.query(`SELECT * FROM referral_history WHERE referrer_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM bonuses WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(
                `SELECT up.*, p.name as plan_name 
                 FROM user_plans up 
                 JOIN plans p ON up.plan_id = p.id 
                 WHERE up.user_id = $1 
                 ORDER BY up.purchased_at DESC`,
                [userId]
            ),
            pool.query(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC`, [userId])
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        let totalEarnings = 0;
        let totalDeposit = 0;
        let totalWithdraw = 0;

        miningHistoryResult.rows.forEach(row => {
            totalEarnings += parseFloat(row.amount || 0);
        });
        referralHistoryResult.rows.forEach(row => {
            totalEarnings += parseFloat(row.commission || 0);
        });
        bonusesResult.rows.forEach(row => {
            totalEarnings += parseFloat(row.amount || 0);
        });
        depositsResult.rows.forEach(row => {
            if (row.status === 'approved') {
                totalDeposit += parseFloat(row.amount || 0);
            }
        });
        withdrawsResult.rows.forEach(row => {
            if (row.status === 'approved') {
                totalWithdraw += parseFloat(row.amount || 0);
            }
        });

        res.render('records', {
            user: userResult.rows[0],
            deposits: depositsResult.rows || [],
            withdraws: withdrawsResult.rows || [],
            miningHistory: miningHistoryResult.rows || [],
            referralHistory: referralHistoryResult.rows || [],
            bonuses: bonusesResult.rows || [],
            purchasedPlans: purchasedPlansResult.rows || [],
            transactions: transactionsResult.rows || [],
            totalEarnings: totalEarnings,
            totalDeposit: totalDeposit,
            totalWithdraw: totalWithdraw,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// ========================
// TEAM
// ========================
app.get('/team', isAuthenticated, validateSession, async (req, res) => {
    const userId = req.session.user.id;
    const baseUrl = getBaseUrl(req);

    try {
        const [userResult, referralsResult, referralHistoryResult] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(`SELECT * FROM users WHERE referred_by = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM referral_history WHERE referrer_id = $1 ORDER BY created_at DESC`, [userId])
        ]);

        if (userResult.rows.length === 0) {
            return res.redirect('/login');
        }

        let totalTeamDeposit = 0;
        let activeMembers = 0;
        const referrals = referralsResult.rows;
        if (referrals) {
            referrals.forEach(ref => {
                totalTeamDeposit += parseFloat(ref.total_deposit || 0);
                if (ref.status === 'active') activeMembers++;
            });
        }

        res.render('team', {
            user: userResult.rows[0],
            referrals: referrals || [],
            referralHistory: referralHistoryResult.rows || [],
            totalTeamDeposit: totalTeamDeposit,
            activeMembers: activeMembers,
            baseUrl: baseUrl,
            success: req.query.success || null,
            error: req.query.error || null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// ========================
// SUPPORT
// ========================
app.get('/support', async (req, res) => {
    try {
        const settingsResult = await pool.query(`SELECT * FROM support_settings`);
        res.render('support', {
            settings: settingsResult.rows[0] || {},
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (err) {
        console.error(err);
        res.render('support', {
            settings: {},
            error: 'Failed to load support settings',
            success: null
        });
    }
});

// ========================
// BUY PLAN
// ========================
app.post('/plan/buy', isAuthenticated, async (req, res) => {
    const { plan_id } = req.body;
    const userId = req.session.user.id;

    try {
        const [planResult, userResult] = await Promise.all([
            pool.query(`SELECT * FROM plans WHERE id = $1 AND status = 'active'`, [plan_id]),
            pool.query(`SELECT balance FROM users WHERE id = $1`, [userId])
        ]);

        if (planResult.rows.length === 0) {
            return res.json({ success: false, message: 'Plan not available' });
        }

        const plan = planResult.rows[0];

        if (userResult.rows.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }

        const user = userResult.rows[0];

        if (parseFloat(user.balance) < parseFloat(plan.investment)) {
            return res.json({ 
                success: false, 
                message: 'Insufficient balance', 
                redirect: '/deposit' 
            });
        }

        await Promise.all([
            pool.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [plan.investment, userId]),
            pool.query(
                `INSERT INTO user_plans (user_id, plan_id, investment, daily_income)
                 VALUES ($1, $2, $3, $4)`,
                [userId, plan_id, plan.investment, plan.daily_income]
            ),
            pool.query(
                `INSERT INTO transactions (user_id, type, amount, description)
                 VALUES ($1, $2, $3, $4)`,
                [userId, 'investment', plan.investment, `Purchased ${plan.name} plan`]
            ),
            pool.query(
                `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
                [userId, 'Plan Purchased', `You purchased ${plan.name} plan for PKR ${plan.investment}`]
            ),
            logActivity(userId, 'plan_purchase', `Purchased ${plan.name} plan for PKR ${plan.investment}`, req.ip)
        ]);

        const newBalanceResult = await pool.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
        req.session.user.balance = newBalanceResult.rows[0].balance;

        res.json({ success: true, message: `Plan ${plan.name} purchased successfully!` });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Plan purchase failed' });
    }
});

// ========================
// ADMIN ROUTES
// ========================
app.get('/admin/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin/dashboard');
    res.render('admin/login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const adminResult = await pool.query(`SELECT * FROM admins WHERE username = $1`, [username]);
        if (adminResult.rows.length === 0) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        const admin = adminResult.rows[0];
        const valid = await bcrypt.compare(password, admin.password);

        if (!valid) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        req.session.admin = { id: admin.id, username: admin.username };
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error(err);
        res.render('admin/login', { error: 'Server error' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const [
            totalUsersResult,
            activeUsersResult,
            totalDepositsResult,
            totalWithdrawsResult,
            pendingDepositsResult,
            pendingWithdrawsResult,
            totalInvestmentsResult,
            totalEarningsResult,
            referralSettingsResult,
            recentDepositsResult,
            recentWithdrawsResult,
            plansResult,
            accountsResult,
            supportSettingsResult,
            activityLogsResult
        ] = await Promise.all([
            pool.query(`SELECT COUNT(*) as total_users FROM users`),
            pool.query(`SELECT COUNT(*) as active_users FROM users WHERE status = 'active'`),
            pool.query(`SELECT COALESCE(SUM(amount), 0) as total_deposits FROM deposits WHERE status = 'approved'`),
            pool.query(`SELECT COALESCE(SUM(amount), 0) as total_withdraws FROM withdraws WHERE status = 'approved'`),
            pool.query(`SELECT COUNT(*) as pending_deposits FROM deposits WHERE status = 'pending'`),
            pool.query(`SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status = 'pending'`),
            pool.query(`SELECT COALESCE(SUM(investment), 0) as total_investments FROM user_plans`),
            pool.query(`SELECT COALESCE(SUM(total_earnings), 0) as total_earnings FROM users`),
            pool.query(`SELECT * FROM referral_settings`),
            pool.query(
                `SELECT d.*, u.username FROM deposits d JOIN users u ON d.user_id = u.id ORDER BY d.created_at DESC LIMIT 20`
            ),
            pool.query(
                `SELECT w.*, u.username FROM withdraws w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC LIMIT 20`
            ),
            pool.query(`SELECT * FROM plans`),
            pool.query(`SELECT * FROM deposit_accounts`),
            pool.query(`SELECT * FROM support_settings`),
            pool.query(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 20`)
        ]);

        res.render('admin/dashboard', {
            stats: {
                total_users: parseInt(totalUsersResult.rows[0].total_users),
                active_users: parseInt(activeUsersResult.rows[0].active_users),
                total_deposits: parseFloat(totalDepositsResult.rows[0].total_deposits),
                total_withdraws: parseFloat(totalWithdrawsResult.rows[0].total_withdraws),
                pending_deposits: parseInt(pendingDepositsResult.rows[0].pending_deposits),
                pending_withdraws: parseInt(pendingWithdrawsResult.rows[0].pending_withdraws),
                total_investments: parseFloat(totalInvestmentsResult.rows[0].total_investments),
                total_earnings: parseFloat(totalEarningsResult.rows[0].total_earnings)
            },
            recentDeposits: recentDepositsResult.rows || [],
            recentWithdraws: recentWithdrawsResult.rows || [],
            plans: plansResult.rows || [],
            accounts: accountsResult.rows || [],
            supportSettings: (supportSettingsResult.rows[0]) || {},
            referralSettings: (referralSettingsResult.rows[0]) || { commission_percentage: 10 },
            activityLogs: activityLogsResult.rows || []
        });

    } catch (err) {
        console.error(err);
        res.render('admin/dashboard', {
            stats: {},
            recentDeposits: [],
            recentWithdraws: [],
            plans: [],
            accounts: [],
            supportSettings: {},
            referralSettings: { commission_percentage: 10 },
            activityLogs: []
        });
    }
});

// ========================
// ADMIN: Approve Deposit
// ========================
app.post('/admin/deposit/approve', isAdmin, async (req, res) => {
    const { deposit_id } = req.body;

    try {
        const depositResult = await pool.query(
            `SELECT * FROM deposits WHERE id = $1 AND status = 'pending'`,
            [deposit_id]
        );

        if (depositResult.rows.length === 0) {
            return res.json({ success: false, message: 'Deposit not found' });
        }

        const deposit = depositResult.rows[0];

        const [userResult, settingsResult] = await Promise.all([
            pool.query(`SELECT referred_by FROM users WHERE id = $1`, [deposit.user_id]),
            pool.query(`SELECT commission_percentage FROM referral_settings`)
        ]);

        const commissionPercent = (settingsResult.rows[0] && settingsResult.rows[0].commission_percentage) || 10;

        const queries = [
            pool.query(`UPDATE deposits SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`, [deposit_id]),
            pool.query(`UPDATE users SET balance = balance + $1, total_deposit = total_deposit + $1 WHERE id = $2`, [deposit.amount, deposit.user_id]),
            pool.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`, [deposit.user_id, 'deposit', deposit.amount, 'Deposit approved']),
            pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [deposit.user_id, 'Deposit Approved', `Your deposit of PKR ${deposit.amount} has been approved.`])
        ];

        if (userResult.rows.length > 0 && userResult.rows[0].referred_by) {
            const commission = parseFloat(deposit.amount) * (commissionPercent / 100);
            queries.push(
                pool.query(`UPDATE users SET balance = balance + $1, team_earnings = team_earnings + $1 WHERE id = $2`, [commission, userResult.rows[0].referred_by]),
                pool.query(`INSERT INTO referral_history (referrer_id, referred_id, commission, deposit_amount) VALUES ($1, $2, $3, $4)`, [userResult.rows[0].referred_by, deposit.user_id, commission, deposit.amount]),
                pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [userResult.rows[0].referred_by, 'Referral Commission', `You earned PKR ${commission} from referral deposit.`])
            );
        }

        await Promise.all(queries);
        await logActivity(deposit.user_id, 'deposit_approved', `Deposit of PKR ${deposit.amount} approved`, req.ip);

        res.json({ success: true, message: 'Deposit approved' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Approval failed' });
    }
});

// ========================
// ADMIN: Reject Deposit
// ========================
app.post('/admin/deposit/reject', isAdmin, async (req, res) => {
    const { deposit_id } = req.body;

    try {
        const depositResult = await pool.query(`SELECT user_id, amount FROM deposits WHERE id = $1`, [deposit_id]);

        const queries = [pool.query(`UPDATE deposits SET status = 'rejected' WHERE id = $1`, [deposit_id])];

        if (depositResult.rows.length > 0) {
            const deposit = depositResult.rows[0];
            queries.push(
                pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [deposit.user_id, 'Deposit Rejected', `Your deposit of PKR ${deposit.amount} has been rejected.`])
            );
        }

        await Promise.all(queries);
        if (depositResult.rows.length > 0) {
            await logActivity(depositResult.rows[0].user_id, 'deposit_rejected', `Deposit of PKR ${depositResult.rows[0].amount} rejected`, req.ip);
        }

        res.json({ success: true, message: 'Deposit rejected' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Rejection failed' });
    }
});

// ========================
// ADMIN: Approve Withdraw
// ========================
app.post('/admin/withdraw/approve', isAdmin, async (req, res) => {
    const { withdraw_id } = req.body;

    try {
        const withdrawResult = await pool.query(
            `SELECT * FROM withdraws WHERE id = $1 AND status = 'pending'`,
            [withdraw_id]
        );

        if (withdrawResult.rows.length === 0) {
            return res.json({ success: false, message: 'Withdraw not found' });
        }

        const withdraw = withdrawResult.rows[0];

        await Promise.all([
            pool.query(`UPDATE withdraws SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`, [withdraw_id]),
            pool.query(`UPDATE users SET balance = balance - $1, total_withdraw = total_withdraw + $1 WHERE id = $2`, [withdraw.amount, withdraw.user_id]),
            pool.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`, [withdraw.user_id, 'withdraw', withdraw.amount, 'Withdraw approved']),
            pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [withdraw.user_id, 'Withdraw Approved', `Your withdraw of PKR ${withdraw.amount} has been approved.`])
        ]);

        await logActivity(withdraw.user_id, 'withdraw_approved', `Withdraw of PKR ${withdraw.amount} approved`, req.ip);
        res.json({ success: true, message: 'Withdraw approved' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Approval failed' });
    }
});

// ========================
// ADMIN: Reject Withdraw
// ========================
app.post('/admin/withdraw/reject', isAdmin, async (req, res) => {
    const { withdraw_id } = req.body;

    try {
        const withdrawResult = await pool.query(`SELECT user_id, amount FROM withdraws WHERE id = $1`, [withdraw_id]);

        const queries = [pool.query(`UPDATE withdraws SET status = 'rejected' WHERE id = $1`, [withdraw_id])];

        if (withdrawResult.rows.length > 0) {
            const withdraw = withdrawResult.rows[0];
            queries.push(
                pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [withdraw.user_id, 'Withdraw Rejected', `Your withdraw of PKR ${withdraw.amount} has been rejected.`])
            );
        }

        await Promise.all(queries);
        if (withdrawResult.rows.length > 0) {
            await logActivity(withdrawResult.rows[0].user_id, 'withdraw_rejected', `Withdraw of PKR ${withdrawResult.rows[0].amount} rejected`, req.ip);
        }

        res.json({ success: true, message: 'Withdraw rejected' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Rejection failed' });
    }
});

// ========================
// ADMIN: Add Plan
// ========================
app.post('/admin/plan/add', isAdmin, async (req, res) => {
    const { name, investment, daily_income } = req.body;

    try {
        await pool.query(`INSERT INTO plans (name, investment, daily_income) VALUES ($1, $2, $3)`, [name, investment, daily_income]);
        res.json({ success: true, message: 'Plan added successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to add plan' });
    }
});

// ========================
// ADMIN: Edit Plan
// ========================
app.post('/admin/plan/edit', isAdmin, async (req, res) => {
    const { plan_id, name, investment, daily_income, status } = req.body;

    try {
        await pool.query(`UPDATE plans SET name = $1, investment = $2, daily_income = $3, status = $4 WHERE id = $5`, [name, investment, daily_income, status, plan_id]);
        res.json({ success: true, message: 'Plan updated successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update plan' });
    }
});

// ========================
// ADMIN: Delete Plan
// ========================
app.post('/admin/plan/delete', isAdmin, async (req, res) => {
    const { plan_id } = req.body;

    try {
        await pool.query(`DELETE FROM plans WHERE id = $1`, [plan_id]);
        res.json({ success: true, message: 'Plan deleted successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to delete plan' });
    }
});

// ========================
// ADMIN: Add Account
// ========================
app.post('/admin/account/add', isAdmin, async (req, res) => {
    const { method, account_title, account_number } = req.body;

    try {
        await pool.query(`INSERT INTO deposit_accounts (method, account_title, account_number) VALUES ($1, $2, $3)`, [method, account_title, account_number]);
        res.json({ success: true, message: 'Account added successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to add account' });
    }
});

// ========================
// ADMIN: Edit Account
// ========================
app.post('/admin/account/edit', isAdmin, async (req, res) => {
    const { account_id, method, account_title, account_number, status } = req.body;

    try {
        await pool.query(`UPDATE deposit_accounts SET method = $1, account_title = $2, account_number = $3, status = $4 WHERE id = $5`, [method, account_title, account_number, status, account_id]);
        res.json({ success: true, message: 'Account updated successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update account' });
    }
});

// ========================
// ADMIN: Delete Account
// ========================
app.post('/admin/account/delete', isAdmin, async (req, res) => {
    const { account_id } = req.body;

    try {
        await pool.query(`DELETE FROM deposit_accounts WHERE id = $1`, [account_id]);
        res.json({ success: true, message: 'Account deleted successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to delete account' });
    }
});

// ========================
// ADMIN: Update Support
// ========================
app.post('/admin/support/update', isAdmin, async (req, res) => {
    const { whatsapp_channel, whatsapp_number, telegram_link, email, phone } = req.body;

    try {
        await pool.query(`UPDATE support_settings SET whatsapp_channel = $1, whatsapp_number = $2, telegram_link = $3, email = $4, phone = $5 WHERE id = 1`, [whatsapp_channel, whatsapp_number, telegram_link, email, phone]);
        res.json({ success: true, message: 'Support settings updated' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update support settings' });
    }
});

// ========================
// ADMIN: Update Referral Settings
// ========================
app.post('/admin/referral/update', isAdmin, async (req, res) => {
    const { commission_percentage } = req.body;

    try {
        await pool.query(`UPDATE referral_settings SET commission_percentage = $1 WHERE id = 1`, [commission_percentage]);
        res.json({ success: true, message: 'Referral settings updated' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update referral settings' });
    }
});

// ========================
// ADMIN: Give Bonus
// ========================
app.post('/admin/bonus/give', isAdmin, async (req, res) => {
    const { user_id, amount, reason } = req.body;

    try {
        await Promise.all([
            pool.query(`INSERT INTO bonuses (user_id, amount, reason) VALUES ($1, $2, $3)`, [user_id, amount, reason]),
            pool.query(`UPDATE users SET balance = balance + $1, bonus_balance = bonus_balance + $1 WHERE id = $2`, [amount, user_id]),
            pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [user_id, 'Bonus Added', `You received a bonus of PKR ${amount}. Reason: ${reason}`])
        ]);

        await logActivity(user_id, 'bonus_received', `Received bonus of PKR ${amount}. Reason: ${reason}`, req.ip);
        res.json({ success: true, message: 'Bonus given successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to give bonus' });
    }
});

// ========================
// ADMIN: Send Notification
// ========================
app.post('/admin/notification/send', isAdmin, async (req, res) => {
    const { user_id, title, message } = req.body;

    try {
        if (user_id === 'all') {
            const usersResult = await pool.query(`SELECT id FROM users`);
            const queries = usersResult.rows.map(user => 
                pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [user.id, title, message])
            );
            await Promise.all(queries);
            res.json({ success: true, message: 'Notification sent to all users' });
        } else {
            await pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [user_id, title, message]);
            res.json({ success: true, message: 'Notification sent successfully' });
        }

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to send notification' });
    }
});

// ========================
// ADMIN: Get Users
// ========================
app.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const usersResult = await pool.query(`SELECT * FROM users ORDER BY created_at DESC`);
        res.json(usersResult.rows || []);

    } catch (err) {
        console.error(err);
        res.json([]);
    }
});

// ========================
// ADMIN: Get Single User
// ========================
app.get('/admin/user/:id', isAdmin, async (req, res) => {
    const userId = req.params.id;

    try {
        const [
            userResult,
            userPlansResult,
            depositsResult,
            withdrawsResult,
            transactionsResult,
            referralsResult
        ] = await Promise.all([
            pool.query(`SELECT * FROM users WHERE id = $1`, [userId]),
            pool.query(`SELECT * FROM user_plans WHERE user_id = $1`, [userId]),
            pool.query(`SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM withdraws WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
            pool.query(`SELECT * FROM users WHERE referred_by = $1`, [userId])
        ]);

        if (userResult.rows.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            user: userResult.rows[0],
            plans: userPlansResult.rows || [],
            deposits: depositsResult.rows || [],
            withdraws: withdrawsResult.rows || [],
            transactions: transactionsResult.rows || [],
            referrals: referralsResult.rows || []
        });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to fetch user' });
    }
});

// ========================
// ADMIN: Update User Status
// ========================
app.post('/admin/user/status', isAdmin, async (req, res) => {
    const { user_id, status } = req.body;

    try {
        await pool.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, user_id]);
        await logActivity(user_id, 'status_change', `User status changed to ${status}`, req.ip);
        res.json({ success: true, message: 'User status updated' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update user' });
    }
});

// ========================
// ADMIN: Delete User
// ========================
app.post('/admin/user/delete', isAdmin, async (req, res) => {
    const { user_id } = req.body;

    try {
        await pool.query(`DELETE FROM users WHERE id = $1`, [user_id]);
        res.json({ success: true, message: 'User deleted successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to delete user' });
    }
});

// ========================
// ADMIN: Update User Balance
// ========================
app.post('/admin/user/balance', isAdmin, async (req, res) => {
    const { user_id, amount, action } = req.body;
    const operator = action === 'add' ? '+' : '-';

    try {
        await Promise.all([
            pool.query(`UPDATE users SET balance = balance ${operator} $1 WHERE id = $2`, [amount, user_id]),
            pool.query(`INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)`, [user_id, 'admin_adjustment', amount, `Admin ${action}ed balance`]),
            pool.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`, [user_id, 'Balance Updated', `Admin ${action}ed PKR ${amount} to your balance`])
        ]);

        await logActivity(user_id, 'balance_adjustment', `Admin ${action}ed PKR ${amount} to balance`, req.ip);
        res.json({ success: true, message: 'Balance updated successfully' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Failed to update balance' });
    }
});

// ========================
// API ROUTES
// ========================
app.get('/api/balance', isAuthenticated, async (req, res) => {
    try {
        const userResult = await pool.query(
            `SELECT balance, total_deposit, total_withdraw, total_earnings, team_earnings, bonus_balance 
             FROM users WHERE id = $1`,
            [req.session.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.json({ success: false });
        }

        req.session.user.balance = userResult.rows[0].balance;

        res.json({ success: true, data: userResult.rows[0] });

    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

app.get('/api/notifications', isAuthenticated, async (req, res) => {
    try {
        const notificationsResult = await pool.query(
            `SELECT * FROM notifications 
             WHERE user_id = $1 OR user_id IS NULL 
             ORDER BY created_at DESC LIMIT 20`,
            [req.session.user.id]
        );

        res.json(notificationsResult.rows || []);

    } catch (err) {
        console.error(err);
        res.json([]);
    }
});

app.post('/api/notification/read', isAuthenticated, async (req, res) => {
    const { notification_id } = req.body;

    try {
        await pool.query(
            `UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2`,
            [notification_id, req.session.user.id]
        );
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

// ========================
// SCHEDULED JOB: RESET TODAY EARNINGS AT MIDNIGHT
// ========================
function scheduleMidnightReset() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 0
    );
    const msToMidnight = night.getTime() - now.getTime();

    console.log(`⏰ Scheduled daily reset in ${Math.floor(msToMidnight / 1000 / 60)} minutes`);

    setTimeout(() => {
        console.log("🔄 Resetting Today's Earnings...");
        resetTodayEarnings();
        setInterval(resetTodayEarnings, 24 * 60 * 60 * 1000);
    }, msToMidnight);
}

async function resetTodayEarnings() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        await pool.query(
            `UPDATE user_plans SET last_collected = $1 WHERE status = 'active'`,
            [yesterdayStr]
        );

        console.log("✅ Today's earnings have been reset to 0");
        
        await pool.query(
            `INSERT INTO activity_logs (user_id, action, details, ip)
             VALUES ($1, $2, $3, $4)`,
            [null, 'system_reset', 'Today\'s earnings reset at midnight', 'system']
        );

    } catch (err) {
        console.error("❌ Error resetting today's earnings:", err);
    }
}

// ========================
// START SERVER
// ========================
app.listen(PORT, async () => {
    console.log(`\n🚀 NovaPay server running at http://localhost:${PORT}`);
    console.log(`👤 User Panel: http://localhost:${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin/login`);
    console.log(`📝 Admin Credentials: admin / admin123`);
    
    const connected = await connectDB();
    if (connected) {
        await createSessionTable();
        await createTables();
        await cleanupOldSessions(); // Cleanup on startup
        console.log("✅ System ready!");
    } else {
        console.log("⚠️ Database not connected. Please check your DATABASE_URL");
    }
    
    scheduleMidnightReset();
});