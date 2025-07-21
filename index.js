import { Client, Databases, Query } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.functionAccessKey);

  const databases = new Databases(client);

  const body = JSON.parse(req.body || '{}');
  const { preferences = [], allergies = [], target } = body;

  if (
    !target ||
    typeof target.calories !== 'number' ||
    typeof target.protein !== 'number' ||
    typeof target.carbs !== 'number' ||
    typeof target.fat !== 'number'
  ) {
    return res.json({ error: "Invalid or missing nutrition target" });
  }

  // 🌀 Function to fetch all documents with pagination
  const fetchAllDocuments = async () => {
    const now = new Date();
    let formattedDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    log("Formatted Date", formattedDate)
    //Give a current date
    formattedDate = "8/1/2025"
    let allDocs = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      const response = await databases.listDocuments(
        process.env.DatabaseID,
        process.env.foodDatasetID,
        [Query.limit(limit), 
        Query.offset(offset),
        Query.equal("date", )
    ]
      );

      const docs = response.documents;
      if (docs.length === 0) break;

      allDocs.push(...docs);
      offset += limit;

      log(`Fetched ${allDocs.length} so far...`);
    }

    return allDocs;
  };

  try {
    let foods = await fetchAllDocuments();

    log("✅ Total foods fetched:", foods.length);

    log("One food:", foods[0])
    foods = foods.filter(food =>
      ['calories', 'protein', 'carbohydrates', 'fat'].every(key =>
        typeof food[key] === 'number' && !isNaN(food[key])
      )
    );

    log("✅ Foods with valid nutrition values:", foods.length);

    if (preferences.length > 0) {
      foods = foods.filter(food =>
        preferences.every(tag => food.tags?.includes(tag))
      );
      log("✅ After preferences filter:", foods.length);
    }

    if (allergies.length > 0) {
      foods = foods.filter(food =>
        !food.ingredients?.some(ing => allergies.includes(ing))
      );
      log("✅ After allergies filter:", foods.length);
    }

    foods.sort((a, b) => {
      const aDensity = (a.protein || 0) / (a.calories || 1);
      const bDensity = (b.protein || 0) / (b.calories || 1);
      return bDensity - aDensity;
    });

    let plan = [];
    let total = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    for (const food of foods) {
      const nextCalories = total.calories + (food.calories || 0);
      const nextProtein = total.protein + (food.protein || 0);
      const nextCarbs = total.carbs + (food.carbs || 0);
      const nextFat = total.fat + (food.fat || 0);

      if (
        nextCalories <= target.calories &&
        nextProtein <= target.protein &&
        nextCarbs <= target.carbs &&
        nextFat <= target.fat
      ) {
        plan.push(food);
        total.calories = nextCalories;
        total.protein = nextProtein;
        total.carbs = nextCarbs;
        total.fat = nextFat;
      }

      if (total.calories >= target.calories * 0.95) break;
    }

    log("✅ Final plan size:", plan.length);

    return res.json({
      plan,
      totals: total
    });

  } catch (err) {
    console.error(err);
    return res.json({
      error: "Something went wrong",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};