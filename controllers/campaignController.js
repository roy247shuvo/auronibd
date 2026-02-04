const db = require('../config/database');

exports.getSmsCampaigns = (req, res) => {
    res.render('admin/campaigns/sms', { 
        title: 'SMS Campaigns',
        path: '/admin/campaigns/sms'
    });
};

exports.getMetaCampaigns = (req, res) => {
    res.render('admin/campaigns/meta', { 
        title: 'Meta Campaigns',
        path: '/admin/campaigns/meta' 
    });
};

exports.getSubscribers = async (req, res) => {
    try {
        const [subscribers] = await db.query("SELECT * FROM subscribers ORDER BY created_at DESC");
        
        res.render('admin/campaigns/subscribers', { 
            title: 'Subscribers List',
            path: '/admin/campaigns/subscribers',
            subscribers
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading subscribers");
    }
};

// NEW: Delete Subscriber
exports.deleteSubscriber = async (req, res) => {
    try {
        const { id } = req.body;
        await db.query("DELETE FROM subscribers WHERE id = ?", [id]);
        res.redirect('/admin/campaigns/subscribers');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting subscriber");
    }
};