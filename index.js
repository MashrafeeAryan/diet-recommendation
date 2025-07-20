import { Client, Databases } from "node-appwrite";

// Main Appwrite function handler
export default async function ({ req, res, log, error }) {
  // Step 1: Set up the Appwrite client
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY); // Only needed if you're using API key access

  // Step 2: Connect to the database
  const databases = new Databases(client);

  // Step 3: Parse request body
  const body = JSON.parse(req.body || '{}');
  const { preferences = [], allergies = [], target } = body;

  // Validate that target exists and has required keys
  if (
    !target ||
    typeof target.calories !== 'number' ||
    typeof target.protein !== 'number' ||
    typeof target.carbs !== 'number' ||
    typeof target.fat !== 'number'
  ) {
    return res.json({ error: "Invalid or missing nutrition target" });
  }

  try {
    // Step 4: Get all food items
    const response = await databases.listDocuments(
      process.env.DB_ID,
      process.env.COLLECTION_ID,
      []
    );

    let foods = response.documents;

    // Filter out foods with invalid nutrition info
    foods = foods.filter(food =>
      ['calories', 'protein', 'carbs', 'fat'].every(key =>
        typeof food[key] === 'number' && !isNaN(food[key])
      )
    );

    // Step 5: Filter by user preferences
    if (preferences.length > 0) {
      foods = foods.filter(food =>
        preferences.every(tag => food.tags?.includes(tag))
      );
    }

    // Step 6: Filter out allergens
    if (allergies.length > 0) {
      foods = foods.filter(food =>
        !food.ingredients?.some(ing => allergies.includes(ing))
      );
    }

    // Step 7: Sort by protein density
    foods.sort((a, b) => {
      const aDensity = (a.protein || 0) / (a.calories || 1);
      const bDensity = (b.protein || 0) / (b.calories || 1);
      return bDensity - aDensity;
    });

    // Step 8: Build the meal plan
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

    // Step 9: Return response
    res.json({
      plan,
      totals: total
    });

  } catch (err) {
    console.error(err);
    res.json({
      error: "Something went wrong",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
}
