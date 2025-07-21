import { Client, Databases, Query } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.functionAccessKey);

  const databases = new Databases(client);

  const body = JSON.parse(req.body || '{}');
  const { preferences = [], allergies = [], target } = body;

  log("📥 Incoming request body:", JSON.stringify(body));

  // Validate target input
  if (
    !target ||
    typeof target.calories !== 'number' ||
    typeof target.protein !== 'number' ||
    typeof target.carbs !== 'number' ||
    typeof target.fat !== 'number'
  ) {
    return res.json({ error: "Invalid or missing nutrition target" });
  }

  // 🌀 Function to fetch all matching documents with direct filters
  const fetchAllDocuments = async () => {
    let allDocs = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      let queryList = [
        Query.limit(limit),
        Query.offset(offset),
      ];

      if (preferences.length > 0) {
        queryList.push(Query.contains("tags", preferences));
      }

      if (allergies.length > 0) {
        queryList.push(Query.notContains("allergies", allergies));
      }

      const response = await databases.listDocuments(
        process.env.DatabaseID,
        process.env.foodDatasetID,
        queryList
      );

      const docs = response.documents;
      log(`📦 Fetched ${docs.length} documents at offset ${offset}`);
      if (docs.length === 0) break;

      allDocs.push(...docs);
      offset += limit;
    }

    log(`✅ Total documents after direct querying: ${allDocs.length}`);
    return allDocs;
  };

  try {
    let foods = await fetchAllDocuments();

    // Filter for valid nutrition values
    const validFoods = foods.filter(food =>
      ['calories', 'protein', 'carbohydrates', 'fat'].every(key =>
        typeof food[key] === 'number' && !isNaN(food[key])
      )
    );

    log(`✅ Foods with valid nutrition data: ${validFoods.length}`);

    // Sort by protein density (protein per calorie)
    validFoods.sort((a, b) => {
      const aDensity = (a.protein || 0) / (a.calories || 1);
      const bDensity = (b.protein || 0) / (b.calories || 1);
      return bDensity - aDensity;
    });

    // Build meal plan
    let plan = [];
    let total = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    for (const food of validFoods) {
      const nextCalories = total.calories + (food.calories || 0);
      const nextProtein = total.protein + (food.protein || 0);
      const nextCarbs = total.carbs + (food.carbohydrates || 0);
      const nextFat = total.fat + (food.fat || 0);

      if (
        nextCalories <= target.calories &&
        nextProtein <= target.protein &&
        nextCarbs <= target.carbs &&
        nextFat <= target.fat
      ) {
        plan.push(food);
        total = {
          calories: nextCalories,
          protein: nextProtein,
          carbs: nextCarbs,
          fat: nextFat
        };
      }

      if (total.calories >= target.calories * 0.95) break;
    }

    log(`📊 Final meal plan contains: ${plan.length} items`);
    log("📈 Nutrition totals:", total);

    return res.json({
      plan,
      totals: total,
      count: plan.length
    });

  } catch (err) {
    error("❌ Error occurred:", err);
    return res.json({
      error: "Something went wrong",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};
