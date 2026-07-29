const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================
// MIDDLEWARE
// ========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'novapay_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

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
// DATABASE
// ========================
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('❌ Database error:', err);
    else console.log('✅ Connected to SQLite database');
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        mobile TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        referral_code TEXT UNIQUE NOT NULL,
        referred_by INTEGER,
        balance REAL DEFAULT 0,
        total_deposit REAL DEFAULT 0,
        total_withdraw REAL DEFAULT 0,
        total_earnings REAL DEFAULT 0,
        bonus_balance REAL DEFAULT 0,
        team_earnings REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        investment REAL NOT NULL,
        daily_income REAL NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        investment REAL NOT NULL,
        daily_income REAL NOT NULL,
        status TEXT DEFAULT 'active',
        last_collected DATE,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT,
        account_title TEXT,
        account_number TEXT,
        slip_image TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        account_holder TEXT NOT NULL,
        account_number TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'completed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mining_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_plan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        collected_date DATE DEFAULT CURRENT_DATE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (user_plan_id) REFERENCES user_plans(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER NOT NULL,
        referred_id INTEGER NOT NULL,
        commission REAL NOT NULL,
        deposit_amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (referrer_id) REFERENCES users(id),
        FOREIGN KEY (referred_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bonuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS support_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        whatsapp_channel TEXT,
        whatsapp_number TEXT,
        telegram_link TEXT,
        email TEXT,
        phone TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS deposit_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        account_title TEXT NOT NULL,
        account_number TEXT NOT NULL,
        status TEXT DEFAULT 'active'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commission_percentage REAL DEFAULT 10
    )`);

    // DEFAULT DATA
    db.get(`SELECT * FROM admins WHERE username = 'admin'`, (err, row) => {
        if (!row) {
            const hashed = bcrypt.hashSync('admin123', 10);
            db.run(`INSERT INTO admins (username, password) VALUES (?, ?)`, ['admin', hashed]);
            console.log('✅ Admin created');
        }
    });

    db.get(`SELECT * FROM plans LIMIT 1`, (err, row) => {
        if (!row) {
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
            plans.forEach(p => {
                db.run(`INSERT INTO plans (name, investment, daily_income) VALUES (?, ?, ?)`, p);
            });
            console.log('✅ Plans created');
        }
    });

    db.get(`SELECT * FROM deposit_accounts LIMIT 1`, (err, row) => {
        if (!row) {
            const accounts = [
                ['EasyPaisa', 'NovaPay International', '1234567890'],
                ['JazzCash', 'NovaPay International', '0987654321'],
                ['Bank Transfer', 'NovaPay Pvt Ltd', 'PK1234567890']
            ];
            accounts.forEach(a => {
                db.run(`INSERT INTO deposit_accounts (method, account_title, account_number) VALUES (?, ?, ?)`, a);
            });
            console.log('✅ Accounts created');
        }
    });

    db.get(`SELECT * FROM support_settings LIMIT 1`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO support_settings (whatsapp_channel, whatsapp_number, telegram_link, email, phone) VALUES (?, ?, ?, ?, ?)`,
                ['https://whatsapp.com/channel/novapay', '+923001234567', 'https://t.me/novapay', 'support@novapay.com', '+923001234567']
            );
            console.log('✅ Support settings created');
        }
    });

    db.get(`SELECT * FROM referral_settings LIMIT 1`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO referral_settings (commission_percentage) VALUES (10)`);
            console.log('✅ Referral settings created');
        }
    });
});

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

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
}

function isAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    res.redirect('/admin/login');
}

function getDateOnly() {
    return new Date().toISOString().split('T')[0];
}

function logActivity(userId, action, details, ip) {
    db.run(`INSERT INTO activity_logs (user_id, action, details, ip) VALUES (?, ?, ?, ?)`,
        [userId, action, details, ip || '127.0.0.1']
    );
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
// USER ROUTES
// ========================
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: null, success: req.query.success || null });
});

app.post('/login', async (req, res) => {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
        return res.render('login', { error: 'Please fill all fields' });
    }

    db.get(`SELECT * FROM users WHERE mobile = ?`, [mobile], async (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Invalid mobile or password' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.render('login', { error: 'Invalid mobile or password' });
        }

        if (user.status === 'suspended') {
            return res.render('login', { error: 'Account suspended. Contact support.' });
        }

        req.session.user = { id: user.id, username: user.username, mobile: user.mobile };
        logActivity(user.id, 'login', 'User logged in', req.ip);
        res.redirect('/dashboard');
    });
});

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('register', { error: null, referral: req.query.ref || '' });
});

app.post('/register', async (req, res) => {
    const { username, mobile, password, confirm_password, referral_code } = req.body;

    if (!username || !mobile || !password || !confirm_password) {
        return res.render('register', { error: 'Please fill all required fields', referral: referral_code || '' });
    }

    if (password !== confirm_password) {
        return res.render('register', { error: 'Passwords do not match', referral: referral_code || '' });
    }

    if (password.length !== 8) {
        return res.render('register', { error: 'Password must be exactly 8 digits', referral: referral_code || '' });
    }

    app.post('/register', async (req, res) => {
    const { username, mobile, password, confirm_password, referral_code, agree } = req.body;
    
    // Check if user agreed to terms
    if (!agree) {
        return res.render('register', { 
            error: 'You must agree to Terms & Conditions', 
            referral: referral_code || '' 
        });
    }
    
    // ... baaki code same
});

    try {
        const existing = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM users WHERE username = ? OR mobile = ?`, [username, mobile], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existing) {
            return res.render('register', { error: 'Username or mobile already exists', referral: referral_code || '' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const refCode = generateReferralCode();
        let referredBy = null;

        if (referral_code) {
            const referrer = await new Promise((resolve, reject) => {
                db.get(`SELECT id FROM users WHERE referral_code = ?`, [referral_code], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (referrer) referredBy = referrer.id;
        }

        const result = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (username, mobile, password, referral_code, referred_by) VALUES (?, ?, ?, ?, ?)`,
                [username, mobile, hashedPassword, refCode, referredBy],
                function(err) {
                    if (err) reject(err);
                    else resolve(this);
                }
            );
        });

        logActivity(result.lastID, 'register', 'User registered', req.ip);
        res.redirect('/login?success=Registration successful! Please login.');
    } catch (error) {
        res.render('register', { error: 'Registration failed: ' + error.message, referral: referral_code || '' });
    }
});

 

// Forgot Password
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

    db.get(`SELECT * FROM users WHERE mobile = ?`, [mobile], async (err, user) => {
        if (err || !user) {
            return res.render('forgot-password', { error: 'Mobile number not found', success: null });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, user.id], function(err) {
            if (err) {
                return res.render('forgot-password', { error: 'Failed to update password', success: null });
            }
            logActivity(user.id, 'password_reset', 'Password reset via forgot password', req.ip);
            res.render('forgot-password', { error: null, success: 'Password updated successfully! Please login.' });
        });
    });
});

// ========================
// TERMS & CONDITIONS
// ========================
app.get('/terms', (req, res) => {
    res.render('terms');
});

app.get('/logout', (req, res) => {
    if (req.session.user) {
        logActivity(req.session.user.id, 'logout', 'User logged out', req.ip);
    }
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');

        db.all(`SELECT up.*, p.name as plan_name FROM user_plans up JOIN plans p ON up.plan_id = p.id WHERE up.user_id = ? AND up.status = 'active'`, [userId], (err, userPlans) => {
            db.all(`SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 10`, [userId], (err, notifications) => {
                db.all(`SELECT * FROM deposit_accounts WHERE status = 'active'`, (err, accounts) => {
                    db.all(`SELECT * FROM plans WHERE status = 'active'`, (err, allPlans) => {
                        
                        // Today's Earnings = Daily income from all active plans + Bonus + Referral Earnings
                        let todayEarnings = 0;
                        if (userPlans) {
                            userPlans.forEach(plan => {
                                todayEarnings += plan.daily_income;
                            });
                        }
                        
                        // Add bonus and team earnings to today's earnings
                        todayEarnings += user.bonus_balance || 0;
                        todayEarnings += user.team_earnings || 0;
                        
                        db.all(`SELECT * FROM users WHERE referred_by = ?`, [userId], (err, referrals) => {
                            db.all(`SELECT * FROM bonuses WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, bonuses) => {
                                db.get(`SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0`, [userId], (err, unread) => {
                                    res.render('dashboard', {
                                        user: user,
                                        userPlans: userPlans || [],
                                        notifications: notifications || [],
                                        accounts: accounts || [],
                                        allPlans: allPlans || [],
                                        todayEarnings: todayEarnings,
                                        referralCount: referrals ? referrals.length : 0,
                                        bonuses: bonuses || [],
                                        unreadCount: unread ? unread.unread : 0,
                                        success: req.query.success || null,
                                        error: req.query.error || null
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ========================
// DEPOSIT
// ========================
app.get('/deposit', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT * FROM deposit_accounts WHERE status = 'active'`, (err, accounts) => {
            res.render('deposit', {
                user: user,
                accounts: accounts || [],
                error: req.query.error || null,
                success: req.query.success || null
            });
        });
    });
});

app.post('/deposit', isAuthenticated, upload.single('slip'), (req, res) => {
    const { amount, payment_method, account_title, account_number } = req.body;
    const userId = req.session.user.id;
    const slipImage = req.file ? '/uploads/' + req.file.filename : null;

    if (!amount || amount < 1300) {
        return res.redirect('/deposit?error=Minimum deposit is PKR 1300');
    }

    db.run(`INSERT INTO deposits (user_id, amount, payment_method, account_title, account_number, slip_image) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, amount, payment_method, account_title, account_number, slipImage],
        function(err) {
            if (err) return res.redirect('/deposit?error=Deposit request failed');
            db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                [userId, 'Deposit Request', `Your deposit of PKR ${amount} is pending approval.`]
            );
            logActivity(userId, 'deposit_request', `Deposit request of PKR ${amount} submitted`, req.ip);
            res.redirect('/deposit?success=Deposit request submitted successfully!');
        }
    );
});

// ========================
// WITHDRAW
// ========================
app.get('/withdraw', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        res.render('withdraw', {
            user: user,
            error: req.query.error || null,
            success: req.query.success || null
        });
    });
});

app.post('/withdraw', isAuthenticated, (req, res) => {
    const { amount, payment_method, account_holder, account_number } = req.body;
    const userId = req.session.user.id;

    if (!amount || amount < 100) {
        return res.redirect('/withdraw?error=Minimum withdraw is PKR 100');
    }

    db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (user.balance < amount) {
            return res.redirect('/withdraw?error=Insufficient balance');
        }

        db.run(`INSERT INTO withdraws (user_id, amount, payment_method, account_holder, account_number) VALUES (?, ?, ?, ?, ?)`,
            [userId, amount, payment_method, account_holder, account_number],
            function(err) {
                if (err) return res.redirect('/withdraw?error=Withdraw request failed');
                db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                    [userId, 'Withdraw Request', `Your withdraw of PKR ${amount} is pending approval.`]
                );
                logActivity(userId, 'withdraw_request', `Withdraw request of PKR ${amount} submitted`, req.ip);
                res.redirect('/withdraw?success=Withdraw request submitted successfully!');
            }
        );
    });
});

// ========================
// MINING
// ========================
app.get('/mining', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT up.*, p.name as plan_name FROM user_plans up JOIN plans p ON up.plan_id = p.id WHERE up.user_id = ? AND up.status = 'active'`, [userId], (err, userPlans) => {
            res.render('mining', {
                user: user,
                userPlans: userPlans || [],
                error: req.query.error || null,
                success: req.query.success || null
            });
        });
    });
});

// ========================
// MINING - COLLECT DAILY (FIXED)
// ========================
app.post('/mining/collect', isAuthenticated, (req, res) => {
    const { plan_id } = req.body;
    const userId = req.session.user.id;
    const today = getDateOnly();

    console.log('📥 Mining collect request:', { plan_id, userId, today });

    // First get the user plan
    db.get(`SELECT * FROM user_plans WHERE id = ? AND user_id = ? AND status = 'active'`, [plan_id, userId], (err, plan) => {
        if (err) {
            console.log('❌ Error fetching plan:', err);
            return res.json({ success: false, message: 'Database error: ' + err.message });
        }
        
        if (!plan) {
            console.log('❌ Plan not found:', plan_id);
            return res.json({ success: false, message: 'Plan not found' });
        }

        console.log('✅ Plan found:', plan);

        // Check if already collected today
        db.get(`SELECT * FROM mining_history WHERE user_plan_id = ? AND collected_date = ?`, [plan_id, today], (err, history) => {
            if (err) {
                console.log('❌ Error checking history:', err);
                return res.json({ success: false, message: 'Database error: ' + err.message });
            }
            
            if (history) {
                console.log('❌ Already collected today');
                return res.json({ success: false, message: 'Already collected today' });
            }

            // Insert mining history
            db.run(`INSERT INTO mining_history (user_id, user_plan_id, amount, collected_date) VALUES (?, ?, ?, ?)`,
                [userId, plan_id, plan.daily_income, today], function(err) {
                    if (err) {
                        console.log('❌ Error inserting history:', err);
                        return res.json({ success: false, message: 'Collection failed: ' + err.message });
                    }

                    // Update user balance
                    db.run(`UPDATE users SET balance = balance + ?, total_earnings = total_earnings + ? WHERE id = ?`,
                        [plan.daily_income, plan.daily_income, userId], function(err) {
                            if (err) {
                                console.log('❌ Error updating balance:', err);
                                return res.json({ success: false, message: 'Balance update failed' });
                            }

                            // Update last_collected
                            db.run(`UPDATE user_plans SET last_collected = ? WHERE id = ?`, [today, plan_id]);

                            // Add notification
                            db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                                [userId, 'Mining Collected', `You collected PKR ${plan.daily_income} from ${plan.plan_name || 'Plan'}`]
                            );
                            
                            logActivity(userId, 'mining_collect', `Collected PKR ${plan.daily_income} from ${plan.plan_name}`, req.ip);

                            // Get updated balance
                            db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
                                console.log('✅ Mining collected successfully! New balance:', user ? user.balance : 0);
                                res.json({ 
                                    success: true, 
                                    message: `Collected PKR ${plan.daily_income}`,
                                    newBalance: user ? user.balance : 0
                                });
                            });
                        });
                });
        });
    });
});

// ========================
// BONUS
// ========================
app.get('/bonus', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT * FROM bonuses WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, bonuses) => {
            res.render('bonus', {
                user: user,
                bonuses: bonuses || [],
                error: req.query.error || null,
                success: req.query.success || null
            });
        });
    });
});

// ========================
// NOTIFICATIONS
// ========================
app.get('/notifications', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC`, [userId], (err, notifications) => {
            // Mark all as read
            db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
            res.render('notifications', {
                user: user,
                notifications: notifications || [],
                error: req.query.error || null,
                success: req.query.success || null
            });
        });
    });
});

// ========================
// RECORDS
// ========================
app.get('/records', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, deposits) => {
            db.all(`SELECT * FROM withdraws WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, withdraws) => {
                db.all(`SELECT mh.*, up.plan_id FROM mining_history mh JOIN user_plans up ON mh.user_plan_id = up.id WHERE mh.user_id = ? ORDER BY mh.collected_date DESC`, [userId], (err, miningHistory) => {
                    db.all(`SELECT * FROM referral_history WHERE referrer_id = ? ORDER BY created_at DESC`, [userId], (err, referralHistory) => {
                        db.all(`SELECT * FROM bonuses WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, bonuses) => {
                            db.all(`SELECT up.*, p.name as plan_name FROM user_plans up JOIN plans p ON up.plan_id = p.id WHERE up.user_id = ? ORDER BY up.purchased_at DESC`, [userId], (err, purchasedPlans) => {
                                res.render('records', {
                                    user: user,
                                    deposits: deposits || [],
                                    withdraws: withdraws || [],
                                    miningHistory: miningHistory || [],
                                    referralHistory: referralHistory || [],
                                    bonuses: bonuses || [],
                                    purchasedPlans: purchasedPlans || [],
                                    error: req.query.error || null,
                                    success: req.query.success || null
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ========================
// TEAM
// ========================
app.get('/team', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.redirect('/login');
        
        db.all(`SELECT * FROM users WHERE referred_by = ? ORDER BY created_at DESC`, [userId], (err, referrals) => {
            db.all(`SELECT * FROM referral_history WHERE referrer_id = ? ORDER BY created_at DESC`, [userId], (err, referralHistory) => {
                let totalTeamDeposit = 0;
                let activeMembers = 0;
                if (referrals) {
                    referrals.forEach(ref => {
                        totalTeamDeposit += ref.total_deposit || 0;
                        if (ref.status === 'active') activeMembers++;
                    });
                }
                
                res.render('team', {
                    user: user,
                    referrals: referrals || [],
                    referralHistory: referralHistory || [],
                    totalTeamDeposit: totalTeamDeposit,
                    activeMembers: activeMembers,
                    success: req.query.success || null,
                    error: req.query.error || null
                });
            });
        });
    });
});

// ========================
// SUPPORT
// ========================
app.get('/support', (req, res) => {
    db.get(`SELECT * FROM support_settings`, (err, settings) => {
        res.render('support', {
            settings: settings || {},
            error: req.query.error || null,
            success: req.query.success || null
        });
    });
});

// ========================
// BUY PLAN
// ========================
app.post('/plan/buy', isAuthenticated, (req, res) => {
    const { plan_id } = req.body;
    const userId = req.session.user.id;

    db.get(`SELECT * FROM plans WHERE id = ? AND status = 'active'`, [plan_id], (err, plan) => {
        if (!plan) return res.json({ success: false, message: 'Plan not available' });

        db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
            if (user.balance < plan.investment) {
                return res.json({ success: false, message: 'Insufficient balance' });
            }

            db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [plan.investment, userId], function(err) {
                if (err) return res.json({ success: false, message: 'Transaction failed' });

                db.run(`INSERT INTO user_plans (user_id, plan_id, investment, daily_income) VALUES (?, ?, ?, ?)`,
                    [userId, plan_id, plan.investment, plan.daily_income], function(err) {
                        if (err) return res.json({ success: false, message: 'Plan purchase failed' });

                        db.run(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)`,
                            [userId, 'investment', plan.investment, `Purchased ${plan.name} plan`]
                        );

                        db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                            [userId, 'Plan Purchased', `You purchased ${plan.name} plan for PKR ${plan.investment}`]
                        );
                        logActivity(userId, 'plan_purchase', `Purchased ${plan.name} plan for PKR ${plan.investment}`, req.ip);

                        res.json({ success: true, message: `Plan ${plan.name} purchased successfully!` });
                    });
            });
        });
    });
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

    db.get(`SELECT * FROM admins WHERE username = ?`, [username], async (err, admin) => {
        if (!admin) return res.render('admin/login', { error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, admin.password);
        if (!valid) return res.render('admin/login', { error: 'Invalid credentials' });

        req.session.admin = { id: admin.id, username: admin.username };
        res.redirect('/admin/dashboard');
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/admin/dashboard', isAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as total_users FROM users`, (err, totalUsers) => {
        db.get(`SELECT COUNT(*) as active_users FROM users WHERE status = 'active'`, (err, activeUsers) => {
            db.get(`SELECT COALESCE(SUM(amount), 0) as total_deposits FROM deposits WHERE status = 'approved'`, (err, totalDeposits) => {
                db.get(`SELECT COALESCE(SUM(amount), 0) as total_withdraws FROM withdraws WHERE status = 'approved'`, (err, totalWithdraws) => {
                    db.get(`SELECT COUNT(*) as pending_deposits FROM deposits WHERE status = 'pending'`, (err, pendingDeposits) => {
                        db.get(`SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status = 'pending'`, (err, pendingWithdraws) => {
                            db.get(`SELECT COALESCE(SUM(investment), 0) as total_investments FROM user_plans`, (err, totalInvestments) => {
                                db.get(`SELECT COALESCE(SUM(total_earnings), 0) as total_earnings FROM users`, (err, totalEarnings) => {
                                    db.get(`SELECT * FROM referral_settings`, (err, referralSettings) => {

                                        db.all(`SELECT d.*, u.username FROM deposits d JOIN users u ON d.user_id = u.id ORDER BY d.created_at DESC LIMIT 20`, (err, recentDeposits) => {
                                            db.all(`SELECT w.*, u.username FROM withdraws w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC LIMIT 20`, (err, recentWithdraws) => {
                                                db.all(`SELECT * FROM plans`, (err, plans) => {
                                                    db.all(`SELECT * FROM deposit_accounts`, (err, accounts) => {
                                                        db.all(`SELECT * FROM support_settings`, (err, supportSettings) => {
                                                            db.all(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 20`, (err, activityLogs) => {
                                                                res.render('admin/dashboard', {
                                                                    stats: {
                                                                        total_users: totalUsers ? totalUsers.total_users : 0,
                                                                        active_users: activeUsers ? activeUsers.active_users : 0,
                                                                        total_deposits: totalDeposits ? totalDeposits.total_deposits : 0,
                                                                        total_withdraws: totalWithdraws ? totalWithdraws.total_withdraws : 0,
                                                                        pending_deposits: pendingDeposits ? pendingDeposits.pending_deposits : 0,
                                                                        pending_withdraws: pendingWithdraws ? pendingWithdraws.pending_withdraws : 0,
                                                                        total_investments: totalInvestments ? totalInvestments.total_investments : 0,
                                                                        total_earnings: totalEarnings ? totalEarnings.total_earnings : 0
                                                                    },
                                                                    recentDeposits: recentDeposits || [],
                                                                    recentWithdraws: recentWithdraws || [],
                                                                    plans: plans || [],
                                                                    accounts: accounts || [],
                                                                    supportSettings: (supportSettings && supportSettings[0]) || {},
                                                                    referralSettings: (referralSettings && referralSettings[0]) || { commission_percentage: 10 },
                                                                    activityLogs: activityLogs || []
                                                                });
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ADMIN: Approve Deposit
app.post('/admin/deposit/approve', isAdmin, (req, res) => {
    const { deposit_id } = req.body;

    db.get(`SELECT * FROM deposits WHERE id = ? AND status = 'pending'`, [deposit_id], (err, deposit) => {
        if (!deposit) return res.json({ success: false, message: 'Deposit not found' });

        db.run(`UPDATE deposits SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = ?`, [deposit_id], function(err) {
            if (err) return res.json({ success: false, message: 'Approval failed' });

            db.run(`UPDATE users SET balance = balance + ?, total_deposit = total_deposit + ? WHERE id = ?`,
                [deposit.amount, deposit.amount, deposit.user_id], function(err) {
                    if (err) return res.json({ success: false, message: 'Balance update failed' });

                    db.run(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)`,
                        [deposit.user_id, 'deposit', deposit.amount, 'Deposit approved']
                    );

                    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                        [deposit.user_id, 'Deposit Approved', `Your deposit of PKR ${deposit.amount} has been approved.`]
                    );

                    // Get referral commission
                    db.get(`SELECT commission_percentage FROM referral_settings`, (err, settings) => {
                        const commissionPercent = (settings && settings.commission_percentage) || 10;
                        
                        db.get(`SELECT referred_by FROM users WHERE id = ?`, [deposit.user_id], (err, user) => {
                            if (user && user.referred_by) {
                                const commission = deposit.amount * (commissionPercent / 100);
                                db.run(`UPDATE users SET balance = balance + ?, team_earnings = team_earnings + ? WHERE id = ?`,
                                    [commission, commission, user.referred_by], function(err) {
                                        if (!err) {
                                            db.run(`INSERT INTO referral_history (referrer_id, referred_id, commission, deposit_amount) VALUES (?, ?, ?, ?)`,
                                                [user.referred_by, deposit.user_id, commission, deposit.amount]
                                            );
                                            db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                                                [user.referred_by, 'Referral Commission', `You earned PKR ${commission} from referral deposit.`]
                                            );
                                        }
                                    }
                                );
                            }
                        });
                    });

                    logActivity(deposit.user_id, 'deposit_approved', `Deposit of PKR ${deposit.amount} approved`, req.ip);
                    res.json({ success: true, message: 'Deposit approved' });
                });
        });
    });
});

// ADMIN: Reject Deposit
app.post('/admin/deposit/reject', isAdmin, (req, res) => {
    const { deposit_id } = req.body;

    db.run(`UPDATE deposits SET status = 'rejected' WHERE id = ?`, [deposit_id], function(err) {
        if (err) return res.json({ success: false, message: 'Rejection failed' });

        db.get(`SELECT user_id, amount FROM deposits WHERE id = ?`, [deposit_id], (err, deposit) => {
            if (deposit) {
                db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                    [deposit.user_id, 'Deposit Rejected', `Your deposit of PKR ${deposit.amount} has been rejected.`]
                );
                logActivity(deposit.user_id, 'deposit_rejected', `Deposit of PKR ${deposit.amount} rejected`, req.ip);
            }
        });

        res.json({ success: true, message: 'Deposit rejected' });
    });
});

// ADMIN: Approve Withdraw
app.post('/admin/withdraw/approve', isAdmin, (req, res) => {
    const { withdraw_id } = req.body;

    db.get(`SELECT * FROM withdraws WHERE id = ? AND status = 'pending'`, [withdraw_id], (err, withdraw) => {
        if (!withdraw) return res.json({ success: false, message: 'Withdraw not found' });

        db.run(`UPDATE withdraws SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = ?`, [withdraw_id], function(err) {
            if (err) return res.json({ success: false, message: 'Approval failed' });

            db.run(`UPDATE users SET balance = balance - ?, total_withdraw = total_withdraw + ? WHERE id = ?`,
                [withdraw.amount, withdraw.amount, withdraw.user_id], function(err) {
                    if (err) return res.json({ success: false, message: 'Balance update failed' });

                    db.run(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)`,
                        [withdraw.user_id, 'withdraw', withdraw.amount, 'Withdraw approved']
                    );

                    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                        [withdraw.user_id, 'Withdraw Approved', `Your withdraw of PKR ${withdraw.amount} has been approved.`]
                    );
                    logActivity(withdraw.user_id, 'withdraw_approved', `Withdraw of PKR ${withdraw.amount} approved`, req.ip);

                    res.json({ success: true, message: 'Withdraw approved' });
                });
        });
    });
});

// ADMIN: Reject Withdraw
app.post('/admin/withdraw/reject', isAdmin, (req, res) => {
    const { withdraw_id } = req.body;

    db.run(`UPDATE withdraws SET status = 'rejected' WHERE id = ?`, [withdraw_id], function(err) {
        if (err) return res.json({ success: false, message: 'Rejection failed' });

        db.get(`SELECT user_id, amount FROM withdraws WHERE id = ?`, [withdraw_id], (err, withdraw) => {
            if (withdraw) {
                db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                    [withdraw.user_id, 'Withdraw Rejected', `Your withdraw of PKR ${withdraw.amount} has been rejected.`]
                );
                logActivity(withdraw.user_id, 'withdraw_rejected', `Withdraw of PKR ${withdraw.amount} rejected`, req.ip);
            }
        });

        res.json({ success: true, message: 'Withdraw rejected' });
    });
});

// ADMIN: Add Plan
app.post('/admin/plan/add', isAdmin, (req, res) => {
    const { name, investment, daily_income } = req.body;

    db.run(`INSERT INTO plans (name, investment, daily_income) VALUES (?, ?, ?)`,
        [name, investment, daily_income], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to add plan' });
            res.json({ success: true, message: 'Plan added successfully' });
        }
    );
});

// ADMIN: Edit Plan
app.post('/admin/plan/edit', isAdmin, (req, res) => {
    const { plan_id, name, investment, daily_income, status } = req.body;

    db.run(`UPDATE plans SET name = ?, investment = ?, daily_income = ?, status = ? WHERE id = ?`,
        [name, investment, daily_income, status, plan_id], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to update plan' });
            res.json({ success: true, message: 'Plan updated successfully' });
        }
    );
});

// ADMIN: Delete Plan
app.post('/admin/plan/delete', isAdmin, (req, res) => {
    const { plan_id } = req.body;

    db.run(`DELETE FROM plans WHERE id = ?`, [plan_id], function(err) {
        if (err) return res.json({ success: false, message: 'Failed to delete plan' });
        res.json({ success: true, message: 'Plan deleted successfully' });
    });
});

// ADMIN: Add Account
app.post('/admin/account/add', isAdmin, (req, res) => {
    const { method, account_title, account_number } = req.body;

    db.run(`INSERT INTO deposit_accounts (method, account_title, account_number) VALUES (?, ?, ?)`,
        [method, account_title, account_number], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to add account' });
            res.json({ success: true, message: 'Account added successfully' });
        }
    );
});

// ADMIN: Edit Account
app.post('/admin/account/edit', isAdmin, (req, res) => {
    const { account_id, method, account_title, account_number, status } = req.body;

    db.run(`UPDATE deposit_accounts SET method = ?, account_title = ?, account_number = ?, status = ? WHERE id = ?`,
        [method, account_title, account_number, status, account_id], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to update account' });
            res.json({ success: true, message: 'Account updated successfully' });
        }
    );
});

// ADMIN: Delete Account
app.post('/admin/account/delete', isAdmin, (req, res) => {
    const { account_id } = req.body;

    db.run(`DELETE FROM deposit_accounts WHERE id = ?`, [account_id], function(err) {
        if (err) return res.json({ success: false, message: 'Failed to delete account' });
        res.json({ success: true, message: 'Account deleted successfully' });
    });
});

// ADMIN: Update Support
app.post('/admin/support/update', isAdmin, (req, res) => {
    const { whatsapp_channel, whatsapp_number, telegram_link, email, phone } = req.body;

    db.run(`UPDATE support_settings SET whatsapp_channel = ?, whatsapp_number = ?, telegram_link = ?, email = ?, phone = ? WHERE id = 1`,
        [whatsapp_channel, whatsapp_number, telegram_link, email, phone], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to update support settings' });
            res.json({ success: true, message: 'Support settings updated' });
        }
    );
});

// ADMIN: Update Referral Settings
app.post('/admin/referral/update', isAdmin, (req, res) => {
    const { commission_percentage } = req.body;

    db.run(`UPDATE referral_settings SET commission_percentage = ? WHERE id = 1`,
        [commission_percentage], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to update referral settings' });
            res.json({ success: true, message: 'Referral settings updated' });
        }
    );
});

// ADMIN: Give Bonus
app.post('/admin/bonus/give', isAdmin, (req, res) => {
    const { user_id, amount, reason } = req.body;

    db.run(`INSERT INTO bonuses (user_id, amount, reason) VALUES (?, ?, ?)`,
        [user_id, amount, reason], function(err) {
            if (err) return res.json({ success: false, message: 'Failed to give bonus' });

            db.run(`UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ? WHERE id = ?`,
                [amount, amount, user_id], function(err) {
                    if (err) return res.json({ success: false, message: 'Balance update failed' });

                    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                        [user_id, 'Bonus Added', `You received a bonus of PKR ${amount}. Reason: ${reason}`]
                    );
                    logActivity(user_id, 'bonus_received', `Received bonus of PKR ${amount}. Reason: ${reason}`, req.ip);

                    res.json({ success: true, message: 'Bonus given successfully' });
                }
            );
        }
    );
});

// ADMIN: Send Notification
app.post('/admin/notification/send', isAdmin, (req, res) => {
    const { user_id, title, message } = req.body;

    if (user_id === 'all') {
        db.all(`SELECT id FROM users`, (err, users) => {
            if (err) return res.json({ success: false, message: 'Failed to send notifications' });
            users.forEach(user => {
                db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                    [user.id, title, message]
                );
            });
            res.json({ success: true, message: 'Notification sent to all users' });
        });
    } else {
        db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
            [user_id, title, message], function(err) {
                if (err) return res.json({ success: false, message: 'Failed to send notification' });
                res.json({ success: true, message: 'Notification sent successfully' });
            }
        );
    }
});

// ADMIN: Get Users
app.get('/admin/users', isAdmin, (req, res) => {
    db.all(`SELECT * FROM users ORDER BY created_at DESC`, (err, users) => {
        res.json(users || []);
    });
});

// ADMIN: Get Single User
app.get('/admin/user/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        db.all(`SELECT * FROM user_plans WHERE user_id = ?`, [userId], (err, userPlans) => {
            db.all(`SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, deposits) => {
                db.all(`SELECT * FROM withdraws WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, withdraws) => {
                    db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, transactions) => {
                        db.all(`SELECT * FROM users WHERE referred_by = ?`, [userId], (err, referrals) => {
                            res.json({
                                success: true,
                                user: user,
                                plans: userPlans || [],
                                deposits: deposits || [],
                                withdraws: withdraws || [],
                                transactions: transactions || [],
                                referrals: referrals || []
                            });
                        });
                    });
                });
            });
        });
    });
});

// ADMIN: Update User Status
app.post('/admin/user/status', isAdmin, (req, res) => {
    const { user_id, status } = req.body;

    db.run(`UPDATE users SET status = ? WHERE id = ?`, [status, user_id], function(err) {
        if (err) return res.json({ success: false, message: 'Failed to update user' });
        logActivity(user_id, 'status_change', `User status changed to ${status}`, req.ip);
        res.json({ success: true, message: 'User status updated' });
    });
});

// ADMIN: Delete User
app.post('/admin/user/delete', isAdmin, (req, res) => {
    const { user_id } = req.body;

    db.run(`DELETE FROM users WHERE id = ?`, [user_id], function(err) {
        if (err) return res.json({ success: false, message: 'Failed to delete user' });
        res.json({ success: true, message: 'User deleted successfully' });
    });
});

// ADMIN: Update User Balance
app.post('/admin/user/balance', isAdmin, (req, res) => {
    const { user_id, amount, action } = req.body;
    const operator = action === 'add' ? '+' : '-';

    db.run(`UPDATE users SET balance = balance ${operator} ? WHERE id = ?`, [amount, user_id], function(err) {
        if (err) return res.json({ success: false, message: 'Failed to update balance' });
        
        db.run(`INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)`,
            [user_id, 'admin_adjustment', amount, `Admin ${action}ed balance`]
        );
        
        db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
            [user_id, 'Balance Updated', `Admin ${action}ed PKR ${amount} to your balance`]
        );
        logActivity(user_id, 'balance_adjustment', `Admin ${action}ed PKR ${amount} to balance`, req.ip);
        
        res.json({ success: true, message: 'Balance updated successfully' });
    });
});

// ========================
// API ROUTES
// ========================
app.get('/api/balance', isAuthenticated, (req, res) => {
    db.get(`SELECT balance, total_deposit, total_withdraw, total_earnings, team_earnings, bonus_balance FROM users WHERE id = ?`,
        [req.session.user.id], (err, user) => {
            if (err) return res.json({ success: false });
            res.json({ success: true, data: user });
        }
    );
});

app.get('/api/notifications', isAuthenticated, (req, res) => {
    db.all(`SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 20`,
        [req.session.user.id], (err, notifications) => {
            res.json(notifications || []);
        }
    );
});

app.post('/api/notification/read', isAuthenticated, (req, res) => {
    const { notification_id } = req.body;
    db.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        [notification_id, req.session.user.id], function(err) {
            res.json({ success: !err });
        }
    );
});

// ========================
// START SERVER
// ========================
app.listen(PORT, () => {
    console.log(`\n🚀 NovaPay server running at http://localhost:${PORT}`);
    console.log(`👤 User Panel: http://localhost:${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin/login`);
    console.log(`📝 Admin Credentials: admin / admin_077\n`);
});