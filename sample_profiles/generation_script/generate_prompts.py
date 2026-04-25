import itertools
import random

# Placeholders for undefined variables in the template
races = ["human", "elf"]
genders = ["female", "male"]
backgrounds = {"forest": "A lush, green forest", "dungeon": "A dark, mysterious dungeon"}
classes = ["wizard", "warrior", "ranger"]

# Base template
# Description: {gender} {race} {class} with long, wet hair
# Attire: A simple, sexy, high-quality tight {class}-themed outfit.
# Environment: {bg_description}. shot on iphone
# Lighting: Bright, direct midday sun, creating sharp shadows and highlighting the water droplets on her skin for a realistic texture.

def generate_prompts():
    prompts = []
    for race, gender, (bg_name, bg_desc), char_class in itertools.product(races, genders, backgrounds.items(), classes):
        prompt = (
            f"Description: A {gender} {race} {char_class} with long, wet hair\n"
            f"Attire: A simple, sexy, high-quality tight {char_class} outfit.\n"
            f"Environment: {bg_desc}. shot on iphone\n"
            f"Lighting: Bright, direct midday sun, creating sharp shadows and highlighting the water droplets on her skin for a realistic texture."
        )
        prompts.append((f"{race}_{gender}_{bg_name}_{char_class}", prompt))
    random.shuffle(prompts)
    return prompts

# Generate and print
for name, prompt in generate_prompts():
    print(f"--- {name} ---\n{prompt}\n")
    input()

