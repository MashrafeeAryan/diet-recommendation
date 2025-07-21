import { Client, Databases, Query } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  // Initialize Appwrite Client
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.functionAccessKey);

  const databases = new Databases(client);

  const body = JSON.parse(req.body || '{}');
  const { preferences = [], allergies = [], target } = body;

  // Validate nutritional targets
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
    log("Formatted Date", formattedDate);

    // Override with hardcoded date (for testing/demo)
    formattedDate = "8/1/2025";

    let allDocs = [];
    const limit = 100;
    let offset = 0;

    // Fetch data in chunks (pagination)
    while (true) {
      const response = await databases.listDocuments(
        process.env.DatabaseID,
        process.env.foodDatasetID,
        [
          Query.limit(limit),
          Query.offset(offset),
          Query.equal("date", formattedDate)
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
    log("One food sample:", foods[0]);

    // Filter foods that have valid nutrient values
    foods = foods.filter(food =>
      ['calories', 'protein', 'carbohydrates', 'fat'].every(key =>
        typeof food[key] === 'number' && !isNaN(food[key])
      )
    );
    log("✅ Foods with valid nutrition values:", foods.length);

    // Filter by user preferences (tags)
    if (preferences.length > 0) {
      foods = foods.filter(food =>
        preferences.every(tag => food.tags?.includes(tag))
      );
      log("✅ After preferences filter:", foods.length);
    }

    // Filter out foods that contain allergens
    if (allergies.length > 0) {
      foods = foods.filter(food =>
        !food.ingredients?.some(ing => allergies.includes(ing))
      );
      log("✅ After allergies filter:", foods.length);
    }

    // Sort by protein density (protein per calorie)
    foods.sort((a, b) => {
      const aDensity = (a.protein || 0) / (a.calories || 1);
      const bDensity = (b.protein || 0) / (b.calories || 1);
      return bDensity - aDensity;
    });

    log("✅ Foods sorted by protein density");

    // 🔢 Custom ratios for each meal
    const mealRatios = {
      breakfast: 0.35, // 35% of the total nutritional goal
      lunch: 0.65      // 65%
    };

    // 🎯 Generate per-meal nutritional targets using the ratios
    const mealTargets = {
      breakfast: {
        calories: target.calories * mealRatios.breakfast,
        protein: target.protein * mealRatios.breakfast,
        carbs: target.carbs * mealRatios.breakfast,
        fat: target.fat * mealRatios.breakfast
      },
      lunch: {
        calories: target.calories * mealRatios.lunch,
        protein: target.protein * mealRatios.lunch,
        carbs: target.carbs * mealRatios.lunch,
        fat: target.fat * mealRatios.lunch
      }
    };

    log("✅ Meal targets calculated:", mealTargets);

    // ⚙️ Function to build a meal plan for a specific meal type
    const buildMealPlan = (foods, mealType, target) => {
      const filtered = foods.filter(f => f.mealType === mealType);
      log(`🍽️ ${mealType} foods available:`, filtered.length);

      const plan = [];
      const total = { calories: 0, protein: 0, carbs: 0, fat: 0 };

      for (const food of filtered) {
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

      log(`✅ Final ${mealType} plan size:`, plan.length);
      return { plan, totals: total };
    };

    // 🍳 Generate meal plans
    const breakfastResult = buildMealPlan(foods, "breakfast", mealTargets.breakfast);
    const lunchResult = buildMealPlan(foods, "lunch", mealTargets.lunch);

    log("Breakfast Result", breakfastResult.length)
    log("Lunch Result", lunchResult.length)
    // ✅ Return both meal plans
    return res.json({
      breakfast: breakfastResult.plan,
      breakfastTotals: breakfastResult.totals,
      lunch: lunchResult.plan,
      lunchTotals: lunchResult.totals
    });

  } catch (err) {
    console.error(err);
    return res.json({
      error: "Something went wrong",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};
