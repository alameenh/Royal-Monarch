const viewProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        // Make sure to populate the category field
        const product = await Product.findById(productId)
            .populate('category', 'name') // This is important to get category name
            .exec();

        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            status: 'Active'
        })
        .populate('category', 'name')
        .limit(4);

        res.render('user/viewProduct', {
            product,
            similarProducts
        });
    } catch (error) {
        console.error('View Product Error:', error);
        res.status(500).send('Error loading product');
    }
}; 