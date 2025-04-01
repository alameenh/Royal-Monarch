import Offer from '../../model/offerModel.js';
import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';

const offerController = {
    getOffers: async (req, res) => {
        try {
            const offers = await Offer.find()
                .populate('productIds')
                .populate('categoryId');
                const categories = await Category.find();
                const products = await Product.find();
            res.render('admin/listOffers', { offers ,categories,products});
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch offers' });
        }
    },

    searchProducts: async (req, res) => {
        try {
            const searchQuery = req.query.q;
            const products = await Product.find({
                name: { $regex: searchQuery, $options: 'i' },
                isActive: true
            }).limit(10);
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Failed to search products' });
        }
    },

    createOffer: async (req, res) => {
        try {
            const { name, type, discount, productIds, categoryId, startDate, endDate } = req.body;

            // Validate dates
            if (new Date(endDate) <= new Date(startDate)) {
                return res.status(400).json({ error: 'End date must be after start date' });
            }

            // Check for existing offers
            const existingOffers = await Offer.find({
                $or: [
                    {
                        type: 'product',
                        productIds: { $in: productIds },
                        startDate: { $lte: endDate },
                        endDate: { $gte: startDate }
                    },
                    {
                        type: 'category',
                        categoryId: categoryId,
                        startDate: { $lte: endDate },
                        endDate: { $gte: startDate }
                    }
                ]
            });

            if (existingOffers.length > 0) {
                return res.status(400).json({ error: 'An offer already exists for this time period' });
            }

            const offer = new Offer({
                name,
                type,
                discount,
                productIds: type === 'product' ? productIds : [],
                categoryId: type === 'category' ? categoryId : null,
                startDate,
                endDate
            });

            await offer.save();
            res.status(201).json(offer);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create offer' });
        }
    },

    updateOffer: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, type, discount, productIds, categoryId, startDate, endDate } = req.body;

            if (new Date(endDate) <= new Date(startDate)) {
                return res.status(400).json({ error: 'End date must be after start date' });
            }

            // Check for existing offers (excluding current offer)
            const existingOffers = await Offer.find({
                _id: { $ne: id },
                $or: [
                    {
                        type: 'product',
                        productIds: { $in: productIds },
                        startDate: { $lte: endDate },
                        endDate: { $gte: startDate }
                    },
                    {
                        type: 'category',
                        categoryId: categoryId,
                        startDate: { $lte: endDate },
                        endDate: { $gte: startDate }
                    }
                ]
            });

            if (existingOffers.length > 0) {
                return res.status(400).json({ error: 'An offer already exists for this time period' });
            }

            const offer = await Offer.findByIdAndUpdate(
                id,
                {
                    name,
                    type,
                    discount,
                    productIds: type === 'product' ? productIds : [],
                    categoryId: type === 'category' ? categoryId : null,
                    startDate,
                    endDate
                },
                { new: true }
            );

            res.json(offer);
        } catch (error) {
            res.status(500).json({ error: 'Failed to update offer' });
        }
    },

    deleteOffer: async (req, res) => {
        try {
            const { id } = req.params;
            await Offer.findByIdAndDelete(id);
            res.json({ message: 'Offer deleted successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete offer' });
        }
    }
};

export default offerController;
