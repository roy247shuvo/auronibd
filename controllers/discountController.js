// 1. Coupons
exports.getCoupons = (req, res) => {
    res.render('admin/discounts/coupons/index', { 
        title: 'Coupons List',
        path: '/admin/discounts/coupons',
        tab: 'list'
    });
};

exports.getCouponUsage = (req, res) => {
    res.render('admin/discounts/coupons/usage', { 
        title: 'Coupon Usage History',
        path: '/admin/discounts/coupons', // Keeps the sidebar active
        tab: 'usage'
    });
};

// 2. Credits
exports.getCredits = (req, res) => {
    res.render('admin/discounts/credits/index', { 
        title: 'Store Credits',
        path: '/admin/discounts/credits',
        tab: 'list'
    });
};

exports.getCreditUsage = (req, res) => {
    res.render('admin/discounts/credits/usage', { 
        title: 'Credit Usage History',
        path: '/admin/discounts/credits', // Keeps the sidebar active
        tab: 'usage'
    });
};