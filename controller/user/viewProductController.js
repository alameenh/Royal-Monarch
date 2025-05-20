import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import User from '../../model/userModel.js';
import Wishlist from '../../model/wishlistModel.js';
import CartItem from '../../model/cartModel.js';
import mongoose from 'mongoose';
import Offer from '../../model/offerModel.js';

const viewProduct = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;

        console.log('Viewing product:', { productId, userId });

        if (!productId) {
            console.log('No product ID provided');
            return res.status(400).render('error', { 
                message: 'Product ID is required' 
            });
        }
        
        // Get the product details with proper population
        const product = await Product.findById(productId)
            .populate({
                path: 'category',
                select: 'name'
            })
            .lean();

        if (!product) {
            console.log('Product not found');
            return res.status(404).render('error', { 
                message: 'Product not found' 
            });
        }

        if (product.status !== 'Active') {
            console.log('Product not active');
            return res.status(404).render('error', { 
                message: 'This product is not available' 
            });
        }

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Initialize wishlist and cart data
        let wishlistStatus = {};
        let isInWishlist = false;
        let wishlistCount = 0;
        let cartItems = [];
        let cartCount = 0;

        // Get wishlist and cart data if user is logged in
        if (userId) {
            // Get wishlist data
            const wishlist = await Wishlist.findOne({ userId });
            if (wishlist) {
                wishlistCount = wishlist.products.length;
                wishlistStatus = wishlist.products.reduce((acc, item) => {
                    acc[item.productId.toString()] = acc[item.productId.toString()] || {};
                    acc[item.productId.toString()][item.variantType] = true;
                    return acc;
                }, {});
            }

            // Get cart data
            cartItems = await CartItem.find({ userId }).lean();
            cartCount = await CartItem.countDocuments({ userId });
        }

        // Mark which variants are in cart and add offer information for main product
        product.variants = product.variants.map(variant => {
            const inCart = cartItems.some(item => 
                item.productId.toString() === productId && 
                item.variantType === variant.type
            );
            const inWishlist = wishlistStatus[productId]?.[variant.type] || false;
            
            // Find applicable offer for this variant
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === productId)
            );

            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === product.category._id.toString()
            );

            const applicableOffer = productOffer || categoryOffer;
            const offerName = applicableOffer ? applicableOffer.name : null;
            const offerDiscount = applicableOffer ? applicableOffer.discount : 0;

            // Ensure specifications are properly handled
            const specifications = Array.isArray(variant.specifications) ? variant.specifications : [];

            return { 
                ...variant,
                inCart,
                inWishlist,
                offerName,
                discount: Math.max(variant.discount || 0, offerDiscount),
                specifications // Include specifications
            };
        });

        // Check if the first variant is in wishlist
        if (product.variants.length > 0) {
            isInWishlist = product.variants[0].inWishlist;
        }

        // Get similar products from same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: productId },
            status: 'Active'
        })
        .populate('category', 'name')
        .lean()
        .limit(5);

        // Process similar products to include offer information and cart/wishlist status
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

            // Process variants with cart status and offers
            similarProduct.variants = similarProduct.variants.map(variant => {
                const inCart = cartItems.some(item => 
                    item.productId.toString() === similarProduct._id.toString() && 
                    item.variantType === variant.type
                );
                const inWishlist = wishlistStatus[similarProduct._id.toString()]?.[variant.type] || false;

                // Calculate prices with offer
                const originalPrice = variant.price;
                const discount = applicableOffer ? applicableOffer.discount : 0;
                const discountedPrice = Math.round(originalPrice * (1 - discount/100));

                return {
                    ...variant,
                    inCart,
                    inWishlist,
                    originalPrice,
                    discountedPrice,
                    discount,
                    offer: applicableOffer ? {
                        type: applicableOffer.type,
                        name: applicableOffer.name,
                        discount: applicableOffer.discount
                    } : null
                };
            });

            return {
                ...similarProduct,
                offer: applicableOffer ? {
                    type: applicableOffer.type,
                    name: applicableOffer.name,
                    discount: applicableOffer.discount
                } : null
            };
        });

        console.log('Rendering viewProduct template');
        res.render('user/viewProduct', {
            product,
            similarProducts: processedSimilarProducts,
            isInWishlist,
            initialCartStatus: product.variants[0].inCart,
            wishlistCount,
            cartCount,
            scripts: getProductViewScripts()
        });
    } catch (error) {
        console.error('View Product Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading product details' 
        });
    }
};

const getProductsByCategory = async (req, res) => {
    try {
        const categoryId = req.params.categoryId;
        const page = parseInt(req.query.page) || 1;
        const limit = 12;

        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        const products = await Product.find({
            category: categoryId,
            status: 'Active'
        })
        .populate('category')
        .skip((page - 1) * limit)
        .limit(limit);

        const total = await Product.countDocuments({
            category: categoryId,
            status: 'Active'
        });

        res.json({
            success: true,
            products,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalProducts: total
            }
        });

    } catch (error) {
        console.error('Category Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching category products'
        });
    }
};

const searchProducts = async (req, res) => {
    try {
        const { query, minPrice, maxPrice, sortBy, order } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 12;

        const searchQuery = {
            status: 'Active',
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { brand: { $regex: query, $options: 'i' } }
            ]
        };

        if (minPrice || maxPrice) {
            searchQuery['variants.price'] = {};
            if (minPrice) searchQuery['variants.price'].$gte = parseInt(minPrice);
            if (maxPrice) searchQuery['variants.price'].$lte = parseInt(maxPrice);
        }

        const sortOptions = {};
        if (sortBy) {
            sortOptions[sortBy] = order === 'asc' ? 1 : -1;
        }

        const products = await Product.find(searchQuery)
            .populate('category')
            .sort(sortOptions)
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Product.countDocuments(searchQuery);

        res.json({
            success: true,
            products,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalProducts: total
            }
        });

    } catch (error) {
        console.error('Search Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching products'
        });
    }
};

// Add a new method to toggle wishlist status
const toggleWishlist = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;
        const { variantType } = req.body;
        const WISHLIST_LIMIT = 10;  // Define the wishlist limit
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please login to add items to wishlist'
            });
        }

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        if (!variantType) {
            return res.status(400).json({
                success: false,
                message: 'Variant type is required'
            });
        }
        
        // Find user's wishlist
        let wishlist = await Wishlist.findOne({ userId });
        
        // If no wishlist exists, create one
        if (!wishlist) {
            wishlist = new Wishlist({
                userId,
                products: [{
                    productId: new mongoose.Types.ObjectId(productId),
                    variantType,
                    addedAt: new Date()
                }]
            });
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist',
                wishlistCount: 1
            });
        }
        
        // Check if product with specific variant is already in wishlist
        const productIndex = wishlist.products.findIndex(
            item => item.productId && item.productId.toString() === productId && item.variantType === variantType
        );
        
        if (productIndex > -1) {
            // Remove from wishlist
            wishlist.products.splice(productIndex, 1);
            await wishlist.save();
            return res.json({
                success: true,
                added: false,
                message: 'Product removed from wishlist',
                wishlistCount: wishlist.products.length
            });
        } else {
            // Check wishlist limit before adding
            if (wishlist.products.length >= WISHLIST_LIMIT) {
                return res.status(400).json({
                    success: false,
                    message: 'Wishlist limit reached (maximum 10 items)'
                });
            }
            
            // Add to wishlist
            wishlist.products.push({
                productId: new mongoose.Types.ObjectId(productId),
                variantType,
                addedAt: new Date()
            });
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist',
                wishlistCount: wishlist.products.length
            });
        }
    } catch (error) {
        console.error('Toggle Wishlist Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating wishlist'
        });
    }
};

// Add these new functions at the end of the file, before the export
const getProductViewScripts = () => {
    return `
    function updateMainImage(src) {
        const mainImage = document.getElementById('mainImage');
        mainImage.src = src;
        // Reset zoom state when changing images
        mainImage.classList.remove('zoomed');
        mainImage.style.transformOrigin = 'center center';
        
        // Reset zoom lens and result
        const zoomLens = document.querySelector('.zoom-lens');
        const zoomResult = document.querySelector('.zoom-result');
        if (zoomLens) zoomLens.style.display = 'none';
        if (zoomResult) zoomResult.style.display = 'none';
        
        // Update zoomed image source
        const zoomedImg = document.querySelector('.zoom-result img');
        if (zoomedImg) zoomedImg.src = src;
    }

    function updateVariantDetails() {
        const select = document.getElementById('variantSelect');
        const selectedOption = select.options[select.selectedIndex];
        const cartBtn = document.getElementById('cartBtn');
        const buyNowBtn = document.getElementById('buyNowBtn');
        
        // Update price
        const price = selectedOption.getAttribute('data-price');
        const discount = selectedOption.getAttribute('data-discount');
        const discountedPrice = Math.round(price * (1 - discount/100));

        document.getElementById('currentPrice').textContent = \`₹\${discountedPrice}\`;
        document.getElementById('originalPrice').textContent = \`₹\${price}\`;
        
        // Update discount badge
        const discountBadge = document.getElementById('discountBadge');
        if (discount > 0) {
            discountBadge.textContent = \`\${discount}% OFF\`;
            discountBadge.style.display = 'block';
        } else {
            discountBadge.style.display = 'none';
        }
        
        // Update stock status
        const stock = selectedOption.getAttribute('data-stock');
        const stockStatus = document.getElementById('stockStatus');
        if (stock > 0) {
            stockStatus.innerHTML = \`<span class="text-green-600">In Stock (\${stock} available)</span>\`;
            cartBtn.disabled = false;
            buyNowBtn.disabled = false;
        } else {
            stockStatus.innerHTML = '<span class="text-red-600">Out of Stock</span>';
            cartBtn.disabled = true;
            buyNowBtn.disabled = true;
        }
        
        // Update cart button state
        const inCart = selectedOption.getAttribute('data-in-cart') === 'true';
        if (inCart) {
            cartBtn.textContent = 'Remove from Cart';
            cartBtn.setAttribute('data-action', 'remove');
        } else {
            cartBtn.textContent = 'Add to Cart';
            cartBtn.setAttribute('data-action', 'add');
        }

        // Update specifications
        try {
            const specsData = selectedOption.getAttribute('data-specs');
            const specs = JSON.parse(specsData || '[]');
            const specsList = document.getElementById('specsList');
            
            if (specsList) {
                // Clear existing specifications
                specsList.innerHTML = '';
                
                // Add new specifications
                if (specs && specs.length > 0) {
                    specs.forEach(spec => {
                        const li = document.createElement('li');
                        li.className = 'spec-item text-gray-600';
                        li.textContent = spec;
                        specsList.appendChild(li);
                    });
                } else {
                    const li = document.createElement('li');
                    li.className = 'spec-item text-gray-600';
                    li.textContent = 'No specifications available';
                    specsList.appendChild(li);
                }
            }
        } catch (error) {
            console.error('Error updating specifications:', error);
            const specsList = document.getElementById('specsList');
            if (specsList) {
                specsList.innerHTML = '<li class="spec-item text-gray-600">Error loading specifications</li>';
            }
        }
    }

    function updateCartButtonState(button, inCart) {
        if (inCart) {
            button.textContent = 'Remove from Cart';
            button.setAttribute('data-action', 'remove');
        } else {
            button.textContent = 'Add to Cart';
            button.setAttribute('data-action', 'add');
        }
    }

    async function handleCart(productId, button = null) {
        let variantSelect;
        let selectedOption;
        let variantType;
        let stock;
        let cartBtn;
        let action;

        if (button) {
            // For similar products
            cartBtn = button;
            variantSelect = document.querySelector(\`.variant-select[data-product-id="\${productId}"]\`);
            selectedOption = variantSelect.options[variantSelect.selectedIndex];
            variantType = selectedOption.value;
            stock = parseInt(selectedOption.getAttribute('data-stock'));
            action = cartBtn.getAttribute('data-action');
        } else {
            // For main product
            cartBtn = document.getElementById('cartBtn');
            variantSelect = document.getElementById('variantSelect');
            selectedOption = variantSelect.options[variantSelect.selectedIndex];
            variantType = selectedOption.getAttribute('data-type');
            stock = parseInt(selectedOption.getAttribute('data-stock'));
            action = cartBtn.textContent.trim() === 'Add to Cart' ? 'add' : 'remove';
        }
        
        if (action === 'add' && stock <= 0) {
            Swal.fire({
                icon: 'error',
                title: 'Out of Stock',
                text: 'This variant is currently out of stock'
            });
            return;
        }
        
        try {
            Swal.fire({
                title: action === 'add' ? 'Adding to Cart...' : 'Removing from Cart...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            const response = await fetch(action === 'add' ? '/cart/add' : '/cart/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    productId,
                    variantType
                })
            });

            const data = await response.json();

            if (data.success) {
                Swal.close();

                if (typeof window.updateCartCount === 'function' && data.cartCount !== undefined) {
                    window.updateCartCount(data.cartCount);
                }

                if (button) {
                    if (action === 'add') {
                        cartBtn.textContent = 'Remove from Cart';
                        cartBtn.setAttribute('data-action', 'remove');
                    } else {
                        cartBtn.textContent = 'Add to Cart';
                        cartBtn.setAttribute('data-action', 'add');
                    }
                } else {
                    updateCartButtonState(cartBtn, action === 'add');
                }

                selectedOption.setAttribute('data-in-cart', (action === 'add').toString());

                await Swal.fire({
                    icon: 'success',
                    title: action === 'add' ? 'Added to Cart!' : 'Removed from Cart!',
                    text: action === 'add' ? 
                        \`\${variantType} added to cart successfully\` : 
                        \`\${variantType} removed from cart successfully\`,
                    showConfirmButton: false,
                    timer: 1500
                });
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Cart operation error:', error);
            Swal.close();

            await Swal.fire({
                icon: 'error',
                title: 'Oops...',
                text: error.message || \`Failed to \${action} from cart\`
            });
        }
    }

    function buyNow(productId) {
        const select = document.getElementById('variantSelect');
        const selectedOption = select.options[select.selectedIndex];
        const variantType = selectedOption.getAttribute('data-type');
        const stock = parseInt(selectedOption.getAttribute('data-stock'));
        
        if (stock <= 0) {
            Swal.fire({
                icon: 'error',
                title: 'Out of Stock',
                text: 'This variant is currently out of stock'
            });
            return;
        }
        
        window.location.href = \`/checkout?productId=\${productId}&variantType=\${variantType}\`;
    }

    async function toggleWishlist(productId, button = null) {
        let variantType;
        let selectedVariant;
        
        if (button) {
            variantType = button.getAttribute('data-variant-type');
            const variantSelect = document.querySelector(\`.variant-select[data-product-id="\${productId}"]\`);
            selectedVariant = variantSelect.options[variantSelect.selectedIndex];
        } else {
            const variantSelect = document.getElementById('variantSelect');
            selectedVariant = variantSelect.options[variantSelect.selectedIndex];
            variantType = selectedVariant.getAttribute('data-type');
        }

        if (!variantType) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Please select a variant first',
                confirmButtonColor: '#000',
                showConfirmButton: false,
                timer: 2000
            });
            return;
        }

        Swal.fire({
            title: 'Updating wishlist...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const response = await fetch(\`/wishlist/toggle/\${productId}\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    variantType
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                let wishlistBtn;
                let wishlistIcon;
                
                if (button) {
                    wishlistBtn = button;
                    wishlistIcon = button.querySelector('i');
                } else {
                    wishlistBtn = document.getElementById('wishlistBtn');
                    wishlistIcon = wishlistBtn.querySelector('i');
                }
                
                if (data.added) {
                    wishlistIcon.classList.remove('far', 'text-gray-400');
                    wishlistIcon.classList.add('fas', 'text-red-500');
                } else {
                    wishlistIcon.classList.remove('fas', 'text-red-500');
                    wishlistIcon.classList.add('far', 'text-gray-400');
                }

                selectedVariant.setAttribute('data-in-wishlist', data.added);

                const navbarWishlistIcon = document.querySelector('.fa-heart').parentElement;
                let wishlistBadge = navbarWishlistIcon.querySelector('.cart-badge');
                
                if (data.wishlistCount > 0) {
                    if (!wishlistBadge) {
                        wishlistBadge = document.createElement('span');
                        wishlistBadge.className = 'cart-badge absolute -top-1 -right-1 rounded-full flex items-center justify-center';
                        navbarWishlistIcon.appendChild(wishlistBadge);
                    }
                    wishlistBadge.textContent = data.wishlistCount;
                } else if (wishlistBadge) {
                    wishlistBadge.remove();
                }

                await Swal.fire({
                    icon: data.added ? 'success' : 'info',
                    title: data.added ? 'Added to Wishlist' : 'Removed from Wishlist',
                    text: data.added ? 'This product has been added to your wishlist' : 'This product has been removed from your wishlist',
                    confirmButtonColor: '#000',
                    showConfirmButton: false,
                    timer: 2000
                });
            } else {
                throw new Error(data.message || 'Something went wrong');
            }
        } catch (error) {
            console.error('Error toggling wishlist:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to update wishlist. Please try again.',
                confirmButtonColor: '#000',
                showConfirmButton: false,
                timer: 2000
            });
        }
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
        // Initialize main product cart button
        const mainCartBtn = document.getElementById('cartBtn');
        const mainVariantSelect = document.getElementById('variantSelect');
        const initialInCart = mainVariantSelect.options[mainVariantSelect.selectedIndex].getAttribute('data-in-cart') === 'true';
        updateCartButtonState(mainCartBtn, initialInCart);

        // Add event listener for variant changes
        mainVariantSelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            
            // Debug specifications
            console.log('Selected variant:', selectedOption.value);
            console.log('Raw specs data:', selectedOption.getAttribute('data-specs'));
            
            // Update price
            const price = selectedOption.getAttribute('data-price');
            const discount = selectedOption.getAttribute('data-discount');
            const discountedPrice = Math.round(price * (1 - discount/100));

            document.getElementById('currentPrice').textContent = \`₹\${discountedPrice}\`;
            document.getElementById('originalPrice').textContent = \`₹\${price}\`;
            
            // Update discount badge
            const discountBadge = document.getElementById('discountBadge');
            if (discount > 0) {
                discountBadge.textContent = \`\${discount}% OFF\`;
                discountBadge.style.display = 'block';
            } else {
                discountBadge.style.display = 'none';
            }
            
            // Update stock status
            const stock = selectedOption.getAttribute('data-stock');
            const stockStatus = document.getElementById('stockStatus');
            if (stock > 0) {
                stockStatus.innerHTML = \`<span class="text-green-600">In Stock (\${stock} available)</span>\`;
                mainCartBtn.disabled = false;
            } else {
                stockStatus.innerHTML = '<span class="text-red-600">Out of Stock</span>';
                mainCartBtn.disabled = true;
            }
            
            // Update cart button state
            const inCart = selectedOption.getAttribute('data-in-cart') === 'true';
            updateCartButtonState(mainCartBtn, inCart);

            // Update specifications
            try {
                const specsData = selectedOption.getAttribute('data-specs');
                console.log('Parsing specs data:', specsData);
                const specs = JSON.parse(specsData || '[]');
                console.log('Parsed specs:', specs);
                
                const specsList = document.getElementById('specsList');
                console.log('Specs list element:', specsList);
                
                if (specsList) {
                    // Clear existing specifications
                    specsList.innerHTML = '';
                    
                    // Add new specifications
                    if (specs && specs.length > 0) {
                        specs.forEach(spec => {
                            const li = document.createElement('li');
                            li.className = 'spec-item text-gray-600';
                            li.textContent = spec;
                            specsList.appendChild(li);
                        });
                    } else {
                        const li = document.createElement('li');
                        li.className = 'spec-item text-gray-600';
                        li.textContent = 'No specifications available';
                        specsList.appendChild(li);
                    }
                }
            } catch (error) {
                console.error('Error updating specifications:', error);
                const specsList = document.getElementById('specsList');
                if (specsList) {
                    specsList.innerHTML = '<li class="spec-item text-gray-600">Error loading specifications</li>';
                }
            }
        });

        // Initialize similar products cart buttons
        document.querySelectorAll('.add-to-cart-btn').forEach(button => {
            const productId = button.getAttribute('data-product-id');
            const variantSelect = document.querySelector(\`.variant-select[data-product-id="\${productId}"]\`);
            const option = variantSelect.options[variantSelect.selectedIndex];
            const inCart = option.getAttribute('data-in-cart') === 'true';
            
            if (inCart) {
                button.textContent = 'Remove from Cart';
                button.setAttribute('data-action', 'remove');
            } else {
                button.textContent = 'Add to Cart';
                button.setAttribute('data-action', 'add');
            }
        });

        // Initialize wishlist icons
        document.querySelectorAll('.wishlist-toggle').forEach(button => {
            const inWishlist = button.getAttribute('data-in-wishlist') === 'true';
            const icon = button.querySelector('i');
            if (inWishlist) {
                icon.classList.remove('far');
                icon.classList.add('fas', 'text-red-500');
            } else {
                icon.classList.remove('fas', 'text-red-500');
                icon.classList.add('far');
            }
        });

        // Add event listeners for variant changes in similar products
        document.querySelectorAll('.variant-select').forEach(select => {
            select.addEventListener('change', function() {
                const productId = this.getAttribute('data-product-id');
                const option = this.options[this.selectedIndex];
                const inCart = option.getAttribute('data-in-cart') === 'true';
                const inWishlist = option.getAttribute('data-in-wishlist') === 'true';
                
                const cartBtn = document.querySelector(\`.add-to-cart-btn[data-product-id="\${productId}"]\`);
                if (cartBtn) {
                    if (inCart) {
                        cartBtn.textContent = 'Remove from Cart';
                        cartBtn.setAttribute('data-action', 'remove');
                    } else {
                        cartBtn.textContent = 'Add to Cart';
                        cartBtn.setAttribute('data-action', 'add');
                    }
                }

                const wishlistBtn = document.querySelector(\`.wishlist-toggle[data-product-id="\${productId}"]\`);
                if (wishlistBtn) {
                    wishlistBtn.setAttribute('data-variant-type', option.value);
                    wishlistBtn.setAttribute('data-in-wishlist', inWishlist.toString());
                    const icon = wishlistBtn.querySelector('i');
                    if (inWishlist) {
                        icon.classList.remove('far');
                        icon.classList.add('fas', 'text-red-500');
                    } else {
                        icon.classList.remove('fas', 'text-red-500');
                        icon.classList.add('far');
                    }
                }
            });
        });

        // Handle image loading errors
        document.querySelectorAll('.product-image').forEach(img => {
            img.addEventListener('error', function() {
                const fallback = this.getAttribute('data-fallback');
                if (fallback && this.src !== fallback) {
                    this.src = fallback;
                }
            });
        });

        // Initialize image zoom functionality
        const mainImage = document.getElementById('mainImage');
        const container = document.querySelector('.image-zoom-container');
        let zoomLens = document.querySelector('.zoom-lens');
        let zoomResult = document.querySelector('.zoom-result');

        if (!zoomLens) {
            zoomLens = document.createElement('div');
            zoomLens.className = 'zoom-lens';
            container.appendChild(zoomLens);
        }

        if (!zoomResult) {
            zoomResult = document.createElement('div');
            zoomResult.className = 'zoom-result';
            const zoomedImg = document.createElement('img');
            zoomedImg.src = mainImage.src;
            zoomResult.appendChild(zoomedImg);
            container.appendChild(zoomResult);
        }

        container.addEventListener('mousemove', function(e) {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const lensX = x - zoomLens.offsetWidth / 2;
            const lensY = y - zoomLens.offsetHeight / 2;

            const maxX = rect.width - zoomLens.offsetWidth;
            const maxY = rect.height - zoomLens.offsetHeight;

            zoomLens.style.left = Math.min(Math.max(0, lensX), maxX) + 'px';
            zoomLens.style.top = Math.min(Math.max(0, lensY), maxY) + 'px';

            const zoomedImg = zoomResult.querySelector('img');
            const ratioX = zoomedImg.width / rect.width;
            const ratioY = zoomedImg.height / rect.height;

            zoomedImg.style.left = -lensX * ratioX + 'px';
            zoomedImg.style.top = -lensY * ratioY + 'px';
        });

        container.addEventListener('mouseenter', function() {
            zoomLens.style.display = 'block';
            zoomResult.style.display = 'block';
        });

        container.addEventListener('mouseleave', function() {
            zoomLens.style.display = 'none';
            zoomResult.style.display = 'none';
        });
    });
    `;
};

export default {
    viewProduct,
    getProductsByCategory,
    searchProducts,
    toggleWishlist
};
