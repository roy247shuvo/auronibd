const db = require('../config/database');

exports.getSettings = async (req, res) => {
    try {
        const [accounts] = await db.query("SELECT * FROM bank_accounts ORDER BY id ASC");
        
        res.render('admin/accounts/settings', { 
            title: 'Account Settings',
            accounts: accounts,
            user: req.session.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading account settings");
    }
};

exports.addAccount = async (req, res) => {
    try {
        const { account_name, account_number, bank_name, initial_balance } = req.body;
        
        await db.query(`
            INSERT INTO bank_accounts (account_name, account_number, bank_name, initial_balance, current_balance) 
            VALUES (?, ?, ?, ?, ?)
        `, [account_name, account_number, bank_name || 'Cash', initial_balance || 0, initial_balance || 0]);

        res.redirect('/admin/accounts/settings');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding account");
    }
};

// Update Gateway Fees
exports.updateGatewayFees = async (req, res) => {
    try {
        const { fees } = req.body; // Expecting object { account_id: fee_amount, ... }
        
        for (const [id, fee] of Object.entries(fees)) {
            await db.query("UPDATE bank_accounts SET gateway_fee = ? WHERE id = ?", [fee, id]);
        }
        
        res.redirect('/admin/accounts/settings?success=Gateway fees updated');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/accounts/settings?error=Failed to update fees');
    }
};

exports.editAccount = async (req, res) => {
    try {
        const { id, account_name, account_number, bank_name } = req.body;
        
        await db.query(`
            UPDATE bank_accounts 
            SET account_name = ?, account_number = ?, bank_name = ?
            WHERE id = ?
        `, [account_name, account_number, bank_name, id]);

        res.redirect('/admin/accounts/settings');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating account");
    }
};

exports.deleteAccount = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query("DELETE FROM bank_accounts WHERE id = ?", [id]);
        res.redirect('/admin/accounts/settings');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting account");
    }
};

exports.getTransfers = async (req, res) => {
    try {
        const { tab, type, range, page } = req.query;
        const currentTab = tab || 'view_accounts';
        const filterType = type || 'both'; // both, debit, credit
        const dateRange = range || 'this_month';
        const currentPage = parseInt(page) || 1;
        const limit = 20;
        const offset = (currentPage - 1) * limit;

        // 1. Fetch Accounts (For Tab 1 & Dropdowns)
        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active' ORDER BY account_name ASC");

        // 2. Fetch Transfer History (For Tab 2)
        const [transfers] = await db.query(`
            SELECT t.*, 
                   f.account_name as from_name, f.bank_name as from_bank,
                   to_acc.account_name as to_name, to_acc.bank_name as to_bank
            FROM account_transfers t
            JOIN bank_accounts f ON t.from_account_id = f.id
            JOIN bank_accounts to_acc ON t.to_account_id = to_acc.id
            ORDER BY t.transfer_date DESC, t.id DESC
        `);

        // 3. FETCH TRANSACTIONS (For New Tab 3)
        // We use a UNION to combine Transfers (In/Out) and Vendor Payments
        
        let dateFilter = "";
        const params = [];

        // Date Logic
        if (dateRange === 'today') dateFilter = "AND t_date = CURDATE()";
        else if (dateRange === 'yesterday') dateFilter = "AND t_date = CURDATE() - INTERVAL 1 DAY";
        else if (dateRange === 'this_month') dateFilter = "AND MONTH(t_date) = MONTH(CURRENT_DATE()) AND YEAR(t_date) = YEAR(CURRENT_DATE())";
        else if (dateRange === 'last_7_days') dateFilter = "AND t_date >= CURDATE() - INTERVAL 7 DAY";
        else if (dateRange === 'all_time') dateFilter = ""; 

        // Base SQL Construction
        // FIX: Using CONVERT(... USING utf8mb4) to prevent Illegal mix of collations
        let sql = `
            SELECT SQL_CALC_FOUND_ROWS * FROM (
                -- 1. Transfers OUT (Debit)
                SELECT 
                    at.id as ref_id,
                    'transfer_out' as type,
                    at.from_account_id as account_id,
                    ba.account_name,
                    at.amount,
                    'debit' as direction,
                    at.transfer_date as t_date,
                    CONVERT(CONCAT('Transfer to ', ba2.account_name) USING utf8mb4) as note,
                    CONVERT(at.created_by USING utf8mb4) as created_by,
                    CONVERT(at.trx_id USING utf8mb4) as trx_id,
                    CONVERT(at.nb_trx_id USING utf8mb4) as nb_trx_id,
                    CONVERT(NULL USING utf8mb4) as po_number,
                    NULL as po_id,
                    CONVERT(NULL USING utf8mb4) as order_number
                FROM account_transfers at
                JOIN bank_accounts ba ON at.from_account_id = ba.id
                JOIN bank_accounts ba2 ON at.to_account_id = ba2.id

                UNION ALL

                -- 2. Transfers IN (Credit)
                SELECT 
                    at.id as ref_id,
                    'transfer_in' as type,
                    at.to_account_id as account_id,
                    ba.account_name,
                    at.amount,
                    'credit' as direction,
                    at.transfer_date as t_date,
                    CONVERT(CONCAT('Received from ', ba2.account_name) USING utf8mb4) as note,
                    CONVERT(at.created_by USING utf8mb4) as created_by,
                    CONVERT(at.trx_id USING utf8mb4) as trx_id,
                    CONVERT(at.nb_trx_id USING utf8mb4) as nb_trx_id,
                    CONVERT(NULL USING utf8mb4) as po_number,
                    NULL as po_id,
                    CONVERT(NULL USING utf8mb4) as order_number
                FROM account_transfers at
                JOIN bank_accounts ba ON at.to_account_id = ba.id
                JOIN bank_accounts ba2 ON at.from_account_id = ba2.id

                UNION ALL

                -- 3. Vendor Payments (Debit)
                SELECT 
                    vp.id as ref_id,
                    'vendor_payment' as type,
                    vp.account_id,
                    ba.account_name,
                    vp.amount,
                    'debit' as direction,
                    vp.payment_date as t_date,
                    CONVERT(vp.note USING utf8mb4) as note,
                    CONVERT(vp.created_by USING utf8mb4) as created_by,
                    CONVERT(vp.trx_id USING utf8mb4) as trx_id,
                    CONVERT(vp.nb_trx_id USING utf8mb4) as nb_trx_id,
                    CONVERT(po.po_number USING utf8mb4) as po_number,
                    po.id as po_id,
                    CONVERT(NULL USING utf8mb4) as order_number
                FROM vendor_payments vp
                JOIN bank_accounts ba ON vp.account_id = ba.id
                LEFT JOIN purchase_orders po ON vp.po_id = po.id

                UNION ALL

                -- 4. Customer Orders (Credit/Income)
               SELECT 
                    o.id as ref_id,
                    'customer_payment' as type,
                    o.bank_account_id as account_id,
                    ba.account_name,
                    o.paid_amount as amount,
                    'credit' as direction,
                    DATE(o.created_at) as t_date,
                    CONVERT(CONCAT('Order Sale: ', o.guest_name) USING utf8mb4) as note,
                    CONVERT('System' USING utf8mb4) as created_by,
                    CONVERT(o.payment_trx_id USING utf8mb4) as trx_id,
                    CONVERT(o.nb_trx_id USING utf8mb4) as nb_trx_id,
                    CONVERT(NULL USING utf8mb4) as po_number,
                    NULL as po_id,
                    CONVERT(o.order_number USING utf8mb4) as order_number
                FROM orders o
                JOIN bank_accounts ba ON o.bank_account_id = ba.id
                WHERE o.paid_amount > 0 AND o.bank_account_id IS NOT NULL

                UNION ALL

                -- 5. Expenses (Debit)
                SELECT 
                    e.id as ref_id,
                    'expense' as type,
                    e.account_id,
                    ba.account_name,
                    e.amount,
                    'debit' as direction,
                    e.expense_date as t_date,
                    CONVERT(CONCAT(UPPER(e.category), ': ', e.title) USING utf8mb4) as note,
                    CONVERT('System' USING utf8mb4) as created_by,
                    CONVERT(NULL USING utf8mb4) as trx_id,
                    CONVERT(NULL USING utf8mb4) as nb_trx_id,
                    CONVERT(NULL USING utf8mb4) as po_number,
                    NULL as po_id,
                    CONVERT(NULL USING utf8mb4) as order_number
                FROM expenses e
                JOIN bank_accounts ba ON e.account_id = ba.id
            ) as combined_ledger
            WHERE 1=1 ${dateFilter}
        `;

        // Apply Search Filter (TRX, NB TRX, PO, Order)
        const q = req.query.q;
        if (q && q.trim() !== '') {
            sql += ` AND (trx_id LIKE ? OR nb_trx_id LIKE ? OR po_number LIKE ? OR order_number LIKE ?)`;
            const searchQ = `%${q.trim()}%`;
            params.push(searchQ, searchQ, searchQ, searchQ);
        }

        // Apply Type Filter
        if (filterType !== 'both') {
            sql += ` AND direction = ?`;
            params.push(filterType);
        }

        // Sort & Pagination
        sql += ` ORDER BY t_date DESC, ref_id DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [transactions] = await db.query(sql, params);
        
        // Get Total Count for Pagination
        const [countResult] = await db.query("SELECT FOUND_ROWS() as total");
        const totalRecords = countResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit);

        res.render('admin/accounts/transfers', { 
            title: 'View & Transfers',
            accounts,
            transfers,
            transactions,
            // View Variables
            currentTab,
            filters: { type: filterType, range: dateRange, q: q || '' }, // Added q here to keep search bar filled
            pagination: { current: currentPage, total: totalPages, records: totalRecords },
            user: req.session.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading accounts data: " + err.message);
    }
};

exports.addTransfer = async (req, res) => {
    try {
        // Added trx_id to destructuring
        const { from_account_id, to_account_id, amount, transfer_date, note, trx_id } = req.body;
        const transferAmount = parseFloat(amount);
        const created_by = req.session.user ? req.session.user.name : 'System';

        if (from_account_id == to_account_id) {
            return res.send(`<script>alert("Cannot transfer to the same account."); window.history.back();</script>`);
        }

        const [sender] = await db.query("SELECT current_balance, account_name FROM bank_accounts WHERE id = ?", [from_account_id]);
        
        if (sender.length === 0) return res.send("Source account not found.");
        if (sender[0].current_balance < transferAmount) {
            return res.send(`<script>alert("Insufficient Balance! Account '${sender[0].account_name}' has only ৳${sender[0].current_balance}."); window.history.back();</script>`);
        }

        await db.query(`UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?`, [transferAmount, from_account_id]);
        await db.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [transferAmount, to_account_id]);

        // --- NEW: Generate Internal NB TRX ID ---
        const [settings] = await db.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
        const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
        const nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
        await db.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);

        // Insert: Save Internal ID to 'nb_trx_id' AND External Ref to 'trx_id'
        await db.query(`
            INSERT INTO account_transfers (nb_trx_id, from_account_id, to_account_id, amount, transfer_date, note, created_by, trx_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [nbTrxId, from_account_id, to_account_id, transferAmount, transfer_date, note, created_by, trx_id || null]);

        res.redirect('/admin/accounts/transfers?tab=transfers');

    } catch (err) {
        console.error(err);
        res.status(500).send("Error processing transfer");
    }
};


// [NEW] Render Courier Data Page
exports.getCourierData = async (req, res) => {
    try {
        // Fetch only settled orders (Real Money)
        const [settledOrders] = await db.query(`
            SELECT * FROM orders 
            WHERE settled_at IS NOT NULL 
            ORDER BY settled_at DESC 
            LIMIT 100
        `);

        // Calculate Totals for the View
        let totalReceived = 0;
        let totalDeliveryCost = 0;
        
        settledOrders.forEach(o => {
            totalReceived += parseFloat(o.cod_received || 0);
            totalDeliveryCost += parseFloat(o.courier_delivery_charge || 0);
        });

        res.render('admin/accounts/courier_data', {
            title: 'Courier Settlements',
            layout: 'admin/layout',
            orders: settledOrders,
            stats: { totalReceived, totalDeliveryCost }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading courier data");
    }
};

// [NEW] Get Expenses Page
exports.getExpenses = async (req, res) => {
    try {
        const { month } = req.query;
        let sql = `
            SELECT e.*, ba.account_name, ba.bank_name 
            FROM expenses e
            LEFT JOIN bank_accounts ba ON e.account_id = ba.id
            WHERE 1=1
        `;
        const params = [];

        if (month) {
            sql += " AND e.for_month = ?";
            params.push(month);
        }

        sql += " ORDER BY e.expense_date DESC, e.created_at DESC";

        const [expenses] = await db.query(sql, params);
        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active'");

        res.render('admin/accounts/expenses', {
            title: 'Expense Manager',
            layout: 'admin/layout',
            expenses,
            accounts,
            filterMonth: month || ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading expenses");
    }
};

// [NEW] Add Expense (Deducts from Balance)
exports.addExpense = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { title, amount, category, account_id, for_month, expense_date, note } = req.body;
        const cost = parseFloat(amount);

        // 1. Check Balance
        const [account] = await conn.query("SELECT current_balance, account_name FROM bank_accounts WHERE id = ?", [account_id]);
        if (account.length === 0) throw new Error("Account not found");
        if (account[0].current_balance < cost) throw new Error(`Insufficient funds in ${account[0].account_name}`);

        // 2. Insert Expense
        await conn.query(`
            INSERT INTO expenses (title, amount, category, account_id, for_month, expense_date, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [title, cost, category, account_id, for_month, expense_date, note]);

        // 3. Deduct Money
        await conn.query(`UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?`, [cost, account_id]);

        await conn.commit();
        res.redirect('/admin/accounts/expenses');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.send(`<script>alert("Error: ${err.message}"); window.history.back();</script>`);
    } finally {
        conn.release();
    }
};

// [NEW] Delete Expense (Refunds Balance)
exports.deleteExpense = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        // 1. Get Expense Details
        const [expense] = await conn.query("SELECT * FROM expenses WHERE id = ?", [id]);
        if (expense.length === 0) throw new Error("Expense not found");

        // 2. Refund Money to Account
        if (expense[0].account_id) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [expense[0].amount, expense[0].account_id]);
        }

        // 3. Delete Record
        await conn.query("DELETE FROM expenses WHERE id = ?", [id]);

        await conn.commit();
        res.redirect('/admin/accounts/expenses');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).send("Error deleting expense");
    } finally {
        conn.release();
    }
};

// --- P/L REPORTING (Fixed: Dynamic Gateway Fees & No Packaging) ---
exports.getPLReport = async (req, res) => {
    try {
        let selectedMonth = req.query.month;
        if (!selectedMonth) {
            const date = new Date();
            date.setMonth(date.getMonth() - 1);
            selectedMonth = date.toISOString().slice(0, 7);
        }

        // 1. Fetch Revenue & Basic Stats
        const [orderStats] = await db.query(`
            SELECT 
                SUM(cod_received) as total_cod,
                SUM(paid_amount) as total_advance,
                SUM(courier_delivery_charge) as total_courier_cost,
                COUNT(id) as total_orders
            FROM orders 
            WHERE DATE_FORMAT(created_at, '%Y-%m') = ? 
            AND status != 'cancelled'
        `, [selectedMonth]);

        const totalCOD = parseFloat(orderStats[0].total_cod) || 0;
        const totalAdvance = parseFloat(orderStats[0].total_advance) || 0;
        const totalRevenue = totalCOD + totalAdvance;
        
        // 2. Fetch COGS
        const [cogsResult] = await db.query(`
            SELECT SUM((oi.quantity - oi.returned_quantity) * oi.cost_price) as total_cogs
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE DATE_FORMAT(o.created_at, '%Y-%m') = ?
            AND o.status != 'cancelled'
        `, [selectedMonth]);

        const totalCOGS = parseFloat(cogsResult[0].total_cogs) || 0;

        // 3. Fetch Manual Expenses
        const [expenseStats] = await db.query(`
            SELECT SUM(amount) as total_opex, category
            FROM expenses 
            WHERE for_month = ?
            GROUP BY category
        `, [selectedMonth]);

        let totalOpex = 0;
        let expenseBreakdown = {};
        expenseStats.forEach(e => {
            totalOpex += parseFloat(e.total_opex);
            expenseBreakdown[e.category] = parseFloat(e.total_opex);
        });

        // --- 4. HIDDEN COSTS (Now Exact via 'gateway_fee' column) ---
        // We sum up the captured fees stored in the orders table
        const [feeResult] = await db.query(`
            SELECT SUM(gateway_fee) as total_fees
            FROM orders 
            WHERE DATE_FORMAT(created_at, '%Y-%m') = ? 
            AND status != 'cancelled'
        `, [selectedMonth]);

        const totalCapturedFees = parseFloat(feeResult[0].total_fees) || 0;

        // Breakdown for Display
        expenseBreakdown['transaction_fees'] = totalCapturedFees;

        // 5. Final Calculations
        const totalCourierDelivery = parseFloat(orderStats[0].total_courier_cost) || 0;
        
        // Total Expenses = Delivery + Opex + Transaction Fees
        const totalExpenses = totalCourierDelivery + totalOpex + totalCapturedFees;

        const grossProfit = totalRevenue - totalCOGS;
        const netProfit = grossProfit - totalExpenses;

        res.render('admin/accounts/pl_report', {
            title: 'Monthly P/L Report',
            layout: 'admin/layout',
            month: selectedMonth,
            stats: {
                revenue: totalRevenue,
                breakdown_revenue: {
                    cod: totalCOD,
                    advance: totalAdvance
                },
                cogs: totalCOGS,
                courier_cost: totalCourierDelivery,
                opex: totalOpex,
                // Removed redundant hidden_costs object, everything is in expense_breakdown now
                expense_breakdown: expenseBreakdown,
                gross_profit: grossProfit,
                net_profit: netProfit,
                order_count: orderStats[0].total_orders
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating P/L Report");
    }
};

// --- BALANCE SHEET & CAPITAL LOGIC ---

// --- BALANCE SHEET & CAPITAL LOGIC ---

// 1. Add Capital (Owner Investment)
exports.addCapital = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { amount, investment_date, target_account_id, note } = req.body;
        const investAmount = parseFloat(amount);

        // A. Record Investment (Deposit)
        await conn.query(`
            INSERT INTO capital_investments (amount, type, investment_date, target_account_id, note)
            VALUES (?, 'deposit', ?, ?, ?)
        `, [investAmount, investment_date, target_account_id, note]);

        // B. Add Money to Account
        await conn.query(`
            UPDATE bank_accounts 
            SET current_balance = current_balance + ? 
            WHERE id = ?
        `, [investAmount, target_account_id]);

        await conn.commit();
        res.redirect('/admin/accounts/balance-sheet');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.send(`<script>alert("Error: ${err.message}"); window.history.back();</script>`);
    } finally {
        conn.release();
    }
};

// 2. Withdraw Capital (Owner's Draw) [NEW]
exports.withdrawCapital = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { amount, investment_date, target_account_id, note } = req.body;
        const drawAmount = parseFloat(amount);

        // A. Check Balance
        const [account] = await conn.query("SELECT current_balance, account_name FROM bank_accounts WHERE id = ?", [target_account_id]);
        if (account.length === 0) throw new Error("Account not found");
        if (account[0].current_balance < drawAmount) throw new Error(`Insufficient funds in ${account[0].account_name} to withdraw.`);

        // B. Record Withdrawal
        await conn.query(`
            INSERT INTO capital_investments (amount, type, investment_date, target_account_id, note)
            VALUES (?, 'withdrawal', ?, ?, ?)
        `, [drawAmount, investment_date, target_account_id, note]);

        // C. Deduct Money from Account
        await conn.query(`
            UPDATE bank_accounts 
            SET current_balance = current_balance - ? 
            WHERE id = ?
        `, [drawAmount, target_account_id]);

        await conn.commit();
        res.redirect('/admin/accounts/balance-sheet');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.send(`<script>alert("Error: ${err.message}"); window.history.back();</script>`);
    } finally {
        conn.release();
    }
};

// 3. Get Balance Sheet Data
exports.getBalanceSheet = async (req, res) => {
    try {
        // --- ASSETS ---
        const [accounts] = await db.query("SELECT * FROM bank_accounts");
        let totalCash = 0;
        accounts.forEach(a => totalCash += parseFloat(a.current_balance));

        const [inventory] = await db.query("SELECT SUM(remaining_quantity * buying_price) as total_value FROM inventory_batches WHERE is_active = 1");
        const totalInventory = parseFloat(inventory[0].total_value) || 0;

        const [receivables] = await db.query(`
            SELECT SUM(total_amount) as pending_money 
            FROM orders 
            WHERE sent_to_courier = 'yes' AND settled_at IS NULL AND status NOT IN ('cancelled', 'Returned')
        `);
        const totalReceivables = parseFloat(receivables[0].pending_money) || 0;
        const totalAssets = totalCash + totalInventory + totalReceivables;

        // --- LIABILITIES ---
        const [payables] = await db.query(`
            SELECT SUM(total_amount - paid_amount) as owe_amount 
            FROM purchase_orders 
            WHERE status != 'cancelled' AND total_amount > paid_amount
        `);
        const totalLiabilities = parseFloat(payables[0].owe_amount) || 0;

        // --- EQUITY ---
        // Fetch all capital transactions
        const [capitalHistory] = await db.query(`
            SELECT ci.*, ba.account_name, ba.bank_name 
            FROM capital_investments ci
            LEFT JOIN bank_accounts ba ON ci.target_account_id = ba.id
            ORDER BY ci.investment_date DESC, ci.id DESC
        `);

        // Calculate Net Capital (Deposits - Withdrawals)
        let totalCapital = 0;
        capitalHistory.forEach(tx => {
            if (tx.type === 'deposit') totalCapital += parseFloat(tx.amount);
            else totalCapital -= parseFloat(tx.amount);
        });

        // Retained Earnings = Assets - Liabilities - Net Capital
        const retainedEarnings = totalAssets - totalLiabilities - totalCapital;
        const totalEquity = totalCapital + retainedEarnings;

        res.render('admin/accounts/balance_sheet', {
            title: 'Financial Health',
            layout: 'admin/layout',
            accounts,
            history: capitalHistory, // Pass history to view
            stats: {
                assets: { total: totalAssets, cash: totalCash, inventory: totalInventory, receivables: totalReceivables },
                liabilities: { total: totalLiabilities },
                equity: { total: totalEquity, capital: totalCapital, earnings: retainedEarnings }
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading balance sheet");
    }
};

// --- NEW: Financial Overview ---
exports.getOverview = async (req, res) => {
    try {
        // 1. Get All Accounts & Total Balance
        const [accounts] = await db.query("SELECT * FROM bank_accounts ORDER BY id ASC");
        // Fix: Use 'current_balance' instead of 'balance'
        const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.current_balance || 0), 0);

        // 2. Get Recent Transfers (Last 5)
        const [recentTransfers] = await db.query(`
            SELECT t.*, f.bank_name as from_name, to_acc.bank_name as to_name 
            FROM account_transfers t
            LEFT JOIN bank_accounts f ON t.from_account_id = f.id
            LEFT JOIN bank_accounts to_acc ON t.to_account_id = to_acc.id
            ORDER BY t.created_at DESC LIMIT 5
        `);

        // 3. Get Recent Expenses (Last 5)
        const [recentExpenses] = await db.query("SELECT * FROM expenses ORDER BY expense_date DESC LIMIT 5");

        res.render('admin/accounts/overview', {
            title: 'Financial Overview',
            layout: 'admin/layout',
            accounts,
            totalBalance,
            recentTransfers,
            recentExpenses
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading account overview");
    }
};