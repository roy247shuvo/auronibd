// 1. Get Sales Data Page
exports.getSalesPage = async (req, res) => {
    try {
        // Placeholder: Future logic to fetch detailed sales analytics
        
        res.render('admin/accounts/sales', {
            title: 'Sales Data',
            layout: 'admin/layout'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};