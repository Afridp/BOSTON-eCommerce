const userModel = require('../models/userModel')
const catModel = require('../models/categoryModel')
const productModel = require('../models/productModel')
const couponModel = require('../models/couponModel')
const cartModel = require('../models/cartModel')
const mongoose = require('mongoose')


const loadCart = async (req, res, next) => {
    try {
        const { userid } = req.session
        if (!userid) {

            res.redirect('/login')
        } else {
            const user = await userModel.findById({ _id: userid })
            let currentPage = 'shop';


            const cartData = await cartModel.findOne({ userId: user }).populate({
                path: "items.product_Id",
                populate: [{
                    path: 'offer'
                },
                {
                    path: 'category',
                    populate: {
                        path: 'offer'
                    },
                }]
            });


            let total = 0
            let discountAmt = 0
            let originalAmts = 0

            if (cartData) {

                cartData.items.forEach((product) => {
                    let itemPrice = product.price;
                    originalAmts += itemPrice * product.quantity

                    // Check if there's an offer on the product
                    if (product.product_Id.offer) {

                        const { percentage } = product.product_Id.offer;

                        itemPrice -= (itemPrice * percentage) / 100;

                    } else

                        // Check if there's an offer on the category
                        if (product.product_Id.category.offer) {

                            const { percentage } = product.product_Id.category.offer;
                            itemPrice -= (itemPrice * percentage) / 100;

                        }

                    let price = Math.floor(itemPrice)

                    total += price * product.quantity



                    discountAmt = originalAmts - total
                });
            }
            res.render('shoppingCart', { user, userid, cartData, total, discountAmt, originalAmts, currentPage })
        }
    } catch (err) {
        next(err)
    }
}

const addToCart = async (req, res, next) => {
    try {
        const { productId, selectedColor, selectedSize } = req.body
        console.log(selectedColor, selectedSize);
        const { userid } = req.session
        if (!userid) {
            res.redirect('/login')
        } else {
            const product = await productModel.findOne({ _id: productId }).populate({
                path: 'offer',
                match: { startingDate: { $lte: new Date() }, expiryDate: { $gte: new Date() } }
            }).populate({
                path: 'category',
                populate: {
                    path: 'offer',
                    match: { startingDate: { $lte: new Date() }, expiryDate: { $gte: new Date() } }
                }
            })

            const cart = await cartModel.findOne({ userId: userid })



            if (cart) {

                const existProduct = cart.items.find((x) => x.product_Id.toString() === productId)

                if (existProduct) {

                    if (existProduct.quantity < product.quantity) {

                        let itemPrice = product.price;

                        // Check if there's an offer on the product
                        if (product.offer) {
                            const { percentage } = product.offer;
                            itemPrice -= (itemPrice * percentage) / 100;
                        }

                        // Check if there's an offer on the category
                        else if (product.category.offer) {
                            const { percentage } = product.category.offer;
                            itemPrice -= (itemPrice * percentage) / 100;
                        }
                        await cartModel.findOneAndUpdate({ userId: userid, 'items.product_Id': productId },
                            {
                                $inc: {
                                    'items.$.quantity': req.body.quantity,
                                    'items.$.totalPrice': req.body.quantity * Math.ceil(itemPrice)

                                },
                                $push: {
                                    'items.$.size': selectedSize,
                                    'items.$.color': selectedColor
                                }
                            }
                        )
                    } else {
                        return res.json({ limited: true })
                    }
                } else {
                    let itemPrice = product.price;

                    // Check if there's an offer on the product
                    if (product.offer) {
                        const { percentage } = product.offer;
                        itemPrice -= (itemPrice * percentage) / 100;
                    }

                    // Check if there's an offer on the category
                    else if (product.category.offer) {
                        const { percentage } = product.category.offer;
                        itemPrice -= (itemPrice * percentage) / 100;
                    }
                    let totalPrice = Math.ceil(req.body.quantity * Math.ceil(itemPrice))
                    await cartModel.findOneAndUpdate({ userId: userid },
                        {
                            $push: {
                                items: {
                                    product_Id: req.body.productId,
                                    quantity: req.body.quantity,
                                    size: [selectedSize],
                                    color: [selectedColor],
                                    price: product.price,
                                    totalPrice: totalPrice
                                }
                            }
                        }
                    )

                }

            } else {


                // don't have cart so we create
                let itemPrice = product.price

                if (product.offer) {
                    const { percentage } = product.offer;
                    itemPrice -= (itemPrice * percentage) / 100;
                }

                // Check if there's an offer on the category
                else if (product.category.offer) {
                    const { percentage } = product.category.offer;
                    itemPrice -= (itemPrice * percentage) / 100;
                }

                const cartData = new cartModel({
                    userId: req.session.userid,
                    items: [{
                        product_Id: new mongoose.Types.ObjectId(productId),
                        quantity: req.body.quantity,
                        size: [selectedSize],
                        color: [selectedColor],
                        price: product.price,
                        totalPrice: itemPrice
                    }]
                })

                await cartData.save()
            }
            res.json({ success: true })
        }
    } catch (err) {
        next(err)
    }
}


const deleteItems = async (req, res, next) => {
    try {
        const { userid } = req.session
        const { productId } = req.body
        const userCart = await cartModel.findOne({ userId: userid })

        if (userCart.items.length === 1) {
            await cartModel.deleteOne({ userId: userid })
        } else {
            await cartModel.updateOne({ userId: userid },
                {
                    $pull: {
                        items: { _id: productId }
                    }
                })
        }
        res.json({ success: true })
    } catch (err) {
        next(err)
    }
}

const loadCheckout = async (req, res, next) => {
    try {


        const { userid } = req.session;

        const { coupon } = req.query

        // const coupon = await couponModel.find({})
        // const moment = require("moment");
        // req.session.couponApplied = false;
        // req.session.discountAmount = 0;
        const couponData = await couponModel.findOne({ code: coupon });
        const coupons = await couponModel.find()
        const currentDate = new Date();

        const cart = await cartModel.findOne({ userId: userid }).populate({
            path: "items.product_Id",
            populate: [{
                path: 'offer'
            },
            {
                path: 'category',
                populate: {
                    path: 'offer'
                },
            }]
        });

        let total = 0;
        let originalAmts = 0
        let subtotal = 0;
        // let message = ""
        if (cart) {
            cart.items.forEach((product) => {
                let itemPrice = product.product_Id.price;

                originalAmts += itemPrice * product.quantity

                // Check if there's an offer on the product
                if (product.product_Id.offer) {
                    const { percentage } = product.product_Id.offer;
                    itemPrice -= (product.product_Id.price * percentage / 100)


                } else if (product.product_Id.category.offer) {
                    const { percentage } = product.product_Id.category.offer;
                    itemPrice -= (itemPrice * percentage) / 100;

                }



                total += Math.floor(itemPrice) * product.quantity;

            });


            if (couponData) {
                const usedUser = couponData.user.find((user) => user.toString() == userid)

                if (usedUser) {
                    // console.log("coupon used");
                    // req.session.message = 'you have already used this coupon'
                    return res.redirect('/checkout')
                } else {

                    total = total - couponData.value

                }



            }



            // await Coupon.find({
            //     expireDate: { $gte: new Date(currentDate) },
            // });
            const user = await userModel.findOne({ _id: userid });
            let currentPage = 'shop';
            res.render("checkout", {
                // address: user,
                cart: cart,
                coupon: coupon,
                couponData,
                coupons,
                // wallet: user.wallet,
                currentDate: currentDate,
                // moment: moment,

                currentPage,
                userid, user, total, originalAmts
            });
        }

    } catch (err) {
        next(err)
    }
};

const qtyChanges = async (req, res, next) => {
    try {
        const { count } = req.body;
        const { productId } = req.body;


        const cart = await cartModel.findOne({ userId: req.session.userid })
        // .populate({
        //     path: "items.product_Id",
        //     populate: [{
        //         path: 'offer'
        //     },
        //         {
        //         path: 'category',
        //         populate: {
        //             path: 'offer'
        //         },
        //     }]
        // });
        const product = await productModel.findOne({ _id: productId }).populate(
            'offer').

            populate({
                path: 'category',
                populate: {
                    path: 'offer',

                }
            }

            )
        // console.log(cart);
        const items = cart.items;
        // console.log(items);

        const cartProduct = items.find(
            (product) => product.product_Id.toString() === productId);

        if (count == 1) {

            // console.log(cartProduct.quantity);
            if (cartProduct.quantity < product.quantity) {
                let updatedPrice = product.price;  // Initialize the updated price
                // console.log(updatedPrice,);

                // Check if there's an offer on the product
                if (product.offer) {
                    // console.log(product.offer,"this is offer ");
                    const { percentage } = product.offer;
                    // console.log("haaaai");
                    updatedPrice = updatedPrice - (product.price * percentage) / 100;
                    // console.log(updatedPrice);
                } else if (product.category.offer) {
                    // console.log("haaaaihjghg");
                    const { percentage } = product.category.offer
                    updatedPrice -= (product.price * percentage) / 100
                }
                // console.log(updatedPrice);
                // console.log("haai")
                await cartModel.updateOne(
                    { userId: req.session.userid, 'items.product_Id': productId },
                    {
                        $inc: {
                            'items.$.quantity': 1,
                            'items.$.totalPrice': updatedPrice
                        }
                    }
                );

                res.json({ success: true });
            } else {
                res.json({
                    success: false,
                    message: `The maximum quantity available for this product is ${product.quantity}. Please adjust your quantity.`
                });
            }
        } else if (count == -1) {
            if (cartProduct.quantity > 1) {
                let updatedPrice = product.price;

                // Check if there's an offer on the product
                if (product.offer) {
                    const { percentage } = product.offer;
                    updatedPrice -= (updatedPrice * percentage) / 100;
                }

                await cartModel.updateOne(
                    { userId: req.session.userid, 'items.product_Id': productId },
                    {
                        $inc: {
                            'items.$.quantity': -1,
                            'items.$.totalPrice': -updatedPrice
                        }
                    }
                );
                res.json({ success: true });
            } else {
                res.json({
                    success: false,
                    message: 'Minimum one quantity is needed'
                });
            }
        } else {
            res.json({ success: false, message: 'Invalid count value' });
        }
    } catch (err) {
        next(err)
    }
};





module.exports = {
    loadCart,
    addToCart,
    deleteItems,
    loadCheckout,
    qtyChanges
}