//  6Igzxy5VIHxWd3ZL urbanDB
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const Stripe = require("stripe");
const dotenv = require("dotenv");
dotenv.config();
const admin = require("firebase-admin");

const stripe = new Stripe(process.env.STRIPE_SECRET);

const serviceAccount = require("./admin-sdk.json");

const MY_DOMAIN = process.env.MY_DOMAIN;
const app = express();
const port = process.env.PORT || 3000;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
app.use(cors());
app.use(express.json());
const uri = process.env.MONGO_URL;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const urbanDB = client.db("urbanDB");
const productRequest = urbanDB.collection("productRequest");
const productCollection = urbanDB.collection("products");
const reviewsCollection = urbanDB.collection("reviews");
const categoryCollection = urbanDB.collection("category");
const userCollection = urbanDB.collection("users");
const cartCollection = urbanDB.collection("carts");
const paymentCollection = urbanDB.collection("payments");
app.get("/", (req, res) => {
  res.send("Urban is Running!!");
});
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).send({ error: "Unauthorized" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: "Invalid token" });
    }

    req.decoded = decoded;
    next();
  });
};
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const adminUser = await userCollection.findOne({ email });

  if (!adminUser || adminUser.role !== "admin") {
    return res.status(403).send({ error: "Forbidden: Admin only" });
  }

  next();
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    //carts apis
    app.post("/cart/add", async (req, res) => {
      const { email, productId } = req.body;

      const cart = await cartCollection.findOne({ user: email });

      // If cart doesn't exist, create one
      if (!cart) {
        await cartCollection.insertOne({
          user: email,
          items: [{ productId, qty: 1 }],
        });
        return res.send({ success: true, message: "Item added (new cart)" });
      }

      // If item already exists → increase qty
      const exists = cart.items.find((i) => i.productId === productId);

      if (exists) {
        await cartCollection.updateOne(
          { user: email, "items.productId": productId },
          { $inc: { "items.$.qty": 1 } }
        );
      } else {
        await cartCollection.updateOne(
          { user: email },
          { $push: { items: { productId, qty: 1 } } }
        );
      }

      res.send({ success: true, message: "Item added" });
    });
    app.get("/cart/:email", async (req, res) => {
      const email = req.params.email;
      // 1️⃣ Get the user's cart
      const cart = await cartCollection.findOne({ user: email });
      if (!cart) {
        return res.send({
          items: [],
          subtotal: 0,
          shipping: 0,
          total: 0,
        });
      }

      const productIds = cart.items.map((item) => item.productId);

      // 2️⃣ Fetch product details
      const products = await productCollection
        .find({ _id: { $in: productIds.map((id) => new ObjectId(id)) } })
        .toArray();

      // 3️⃣ Merge product info with quantity
      const itemsWithDetails = cart.items.map((item) => {
        const product = products.find(
          (p) => p._id.toString() === item.productId
        );

        return {
          productId: item.productId,
          name: product?.name,
          price: product?.price,
          img: product?.img,
          quantity: item.qty,
        };
      });

      // 4️⃣ Calculate subtotal & total
      const subtotal = itemsWithDetails.reduce(
        (acc, p) => acc + p.price * p.quantity,
        0
      );

      const shipping = 5;
      const total = subtotal + shipping;

      res.send({
        items: itemsWithDetails,
        subtotal,
        shipping,
        total,
      });
    });
    app.delete("/cart/:email/item/:productId", async (req, res) => {
      try {
        const email = req.params.email;
        //  const query = {user:email}
        if (!email) {
          return res.send({ message: "email not found" });
        }

        //  const cart = await cartCollection.findOne(query)
        //  console.log({cart});

        const productId = req.params.productId; // string

        const result = await cartCollection.updateOne(
          { user: email },
          {
            $pull: {
              items: { productId: productId.trim() },
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ message: "Product not found in cart" });
        }

        res.json({ message: "Product removed successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server Error" });
      }
    });

    //users apis;
    app.post("/users", async (req, res) => {
      try {
        const user = req.body; // receive full user object

        // Check if user exists by email
        const existingUser = await userCollection.findOne({
          email: user.email,
        });

        if (existingUser) {
          return res.status(400).send({ message: "User already exists!" });
        }

        // Insert new user
        const result = await userCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    app.get("/logged-user", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const cursor = await userCollection.findOne(query);
      res.send(cursor);
    });
    app.get("/users", async (req, res) => {
      // const query = {};
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    app.patch("/users/toggleRole", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Email is required" });
        }

        // Find user by email
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        // Toggle role
        const newRole = user.role === "admin" ? "user" : "admin";

        const updateDoc = {
          $set: { role: newRole },
        };

        const result = await userCollection.updateOne({ email }, updateDoc);

        res.send({
          message: `Role updated to ${newRole}`,
          newRole,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //products apis
    app.get("/products", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }

      const cursor = productCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: req.body,
      };
      const result = await productCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    app.post("/products", async (req, res) => {
      const newProduct = req.body;
      const result = await productCollection.insertOne(newProduct);
      res.send(result);
    });
    app.get("/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.findOne(query);
      res.send(result);
    });
    //category apis;
    app.get("/categories", async (req, res) => {
      const cursor = categoryCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/categories/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await categoryCollection.findOne(query);
      res.send(result);
    });
    app.delete("/categories/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await categoryCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/categories/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: req.body,
      };
      const result = await categoryCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.post("/categories", async (req, res) => {
      const newCategory = req.body;
      const result = await categoryCollection.insertOne(newCategory);
      res.send(result);
    });

    //products request apis;
    app.post("/productRequest", async (req, res) => {
      const newProduct = req.body;
      const result = await productRequest.insertOne(newProduct);
      res.send(result);
    });
    app.get("/productRequest", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const cursor = productRequest.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.delete("/productRequest/:_id", async (req, res) => {
      const id = req.params._id;
      const query = { _id: new ObjectId(id) };
      const result = await productRequest.deleteOne(query);
      res.send(result);
    });
    //reviews apis;
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });
    app.get("/reviews", async (req, res) => {
      const cursor = reviewsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // payment apis;

    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { price, email, quantity, products } = req.body; // dynamic amount from frontend

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "E-commerce Payment",
                },
                unit_amount: price * 100, // amount in cents
              },
              quantity: quantity,
            },
          ],
          // metadata: {
          //   userEmail: email,
          //   products,
          // },
          customer_email: email,

          success_url: `${MY_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${MY_DOMAIN}/payment-cancel`,
        });


        //  console.log(session);
        // Save session in DB as pending
        await paymentCollection.insertOne({
          email,
          products,
          totalAmount: price,
          quantity,
          sessionId: session.id,
          status: "pending",
          createdAt: new Date(),
        });
        res.send({ url: session.url });
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
      }
    });

 app.get("/payment-success", async (req, res) => {
   try {
     const { session_id } = req.query;
     const session = await stripe.checkout.sessions.retrieve(session_id);

     if (!session) return res.status(404).json({ error: "Session not found" });

     // Update payment status in DB
     await paymentCollection.updateOne(
       { sessionId: session.id },
       { $set: { status: "paid", paidAt: new Date() } }
     );

     const paymentData = await paymentCollection.findOne({
       sessionId: session.id,
     });

     res.json({
       message: "Payment successful",
       payment: paymentData,
     });
   } catch (error) {
     console.error(error);
     res.status(500).json({ error: error.message });
   }
 });

    app.get('/payment-history', async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, (req, res) => {
  console.log("urban is running");
});
