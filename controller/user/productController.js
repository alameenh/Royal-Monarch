import Product from '../../model/productModel.js';
import Offer from '../../model/offerModel.js';
import mongoose from 'mongoose';

const viewProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.session.userId;
        
        // Get the product details
        const product = await Product.findById(productId)
            .populate('category', 'name') 
            .exec();

        if (!product) {
            return res.status(404).send('Product not found');
        }

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Check if products are in the user's wishlist
        let isInWishlist = false;
        if (userId) {
            const user = await mongoose.model('User').findById(userId);
            if (user && user.wishlist && user.wishlist.includes(productId)) {
                isInWishlist = true;
            }
        }

        // Check if any variants are in the user's cart
        const cartItems = userId ? await mongoose.model('CartItem').find({ 
            userId, productId 
        }) : [];

        // Mark which variants are in cart
        product.variants = product.variants.map(variant => {
            const inCart = cartItems.some(item => item.variantType === variant.type);
            return { 
                ...variant.toObject(), 
                inCart 
            };
        });

        // Get similar products from same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            status: 'Active'
        })
        .populate('category', 'name')
        .limit(4);

        // Process similar products to include offer information
        const processedSimilarProducts = similarProducts.map(similarProduct => {
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === similarProduct._id.toString())
            );

            // Find category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === similarProduct.category._id.toString()
            );

            // Use product offer if available, otherwise use category offer
            const applicableOffer = productOffer || categoryOffer;

            // Calculate discounted price for the base variant using offer (not product discount)
            const baseVariant = similarProduct.variants[0];
            const originalPrice = baseVariant.price;
            const discountedPrice = applicableOffer 
                ? Math.round(originalPrice * (1 - applicableOffer.discount/100))
                : originalPrice;

            return {
                ...similarProduct.toObject(),
                offer: applicableOffer,
                discountedPrice,
                originalPrice
            };
        });

        // Also process the main product to get its applicable offer
        const mainProductOffer = activeOffers.find(offer => 
            offer.type === 'product' && 
            offer.productIds.some(id => id.toString() === productId)
        );

        const mainCategoryOffer = activeOffers.find(offer => 
            offer.type === 'category' && 
            offer.categoryId.toString() === product.category._id.toString()
        );

        // Send product and similar products with offer information to the view
        res.render('user/viewProduct', {
            product,
            similarProducts: processedSimilarProducts,
            mainProductOffer: mainProductOffer || mainCategoryOffer, // For reference in view
            isInWishlist
        });
    } catch (error) {
        console.error('View Product Error:', error);
        res.status(500).send('Error loading product');
    }
}; 