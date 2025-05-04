router.get('/payment/failed/:orderId', isLoggedIn, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ orderId });
        
        if (!order) {
            return res.redirect('/orders');
        }

        res.render('user/paymentFailed', {
            orderId: order.orderId,
            user: req.user
        });
    } catch (error) {
        console.error('Error in payment failed route:', error);
        res.redirect('/orders');
    }
}); 