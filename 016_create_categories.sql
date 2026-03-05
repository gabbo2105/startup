-- CREATE: categories table + keyword-based product classification
-- Adds a category system to products for browsable catalog.
-- ~74% of products classified via keyword matching, rest as "Altro".

-- Create categories table
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_read ON categories
  FOR SELECT USING (true);

CREATE POLICY categories_admin ON categories
  FOR ALL USING (
    (select (auth.jwt() -> 'app_metadata' ->> 'role')) = 'admin'
  );

-- Add category_id to products
ALTER TABLE products ADD COLUMN category_id uuid REFERENCES categories(id);
CREATE INDEX idx_products_category ON products(category_id);

-- Seed categories
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Vini e Spumanti', 'vini-spumanti', 'Wine', 1),
  ('Birre', 'birre', 'Beer', 2),
  ('Liquori e Distillati', 'liquori-distillati', 'GlassWater', 3),
  ('Bevande Analcoliche', 'bevande-analcoliche', 'CupSoda', 4),
  ('Caffe e Te', 'caffe-te', 'Coffee', 5),
  ('Carne e Salumi', 'carne-salumi', 'Beef', 6),
  ('Pesce e Frutti di Mare', 'pesce-frutti-mare', 'Fish', 7),
  ('Latticini e Formaggi', 'latticini-formaggi', 'Milk', 8),
  ('Uova', 'uova', 'Egg', 9),
  ('Pasta, Riso e Cereali', 'pasta-riso-cereali', 'Wheat', 10),
  ('Pane e Prodotti da Forno', 'pane-prodotti-forno', 'Croissant', 11),
  ('Frutta e Verdura', 'frutta-verdura', 'Apple', 12),
  ('Dolci e Pasticceria', 'dolci-pasticceria', 'Cake', 13),
  ('Condimenti e Conserve', 'condimenti-conserve', 'Flame', 14),
  ('Pulizia e Monouso', 'pulizia-monouso', 'SprayCan', 15),
  ('Altro', 'altro', 'Package', 16);

-- Keyword-based classification (order matters: first match wins via WHERE category_id IS NULL)
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'vini-spumanti')
WHERE description ~* '(^vino |vino |wine|chianti|barolo|brunello|prosecco|champagne|spumante|amarone|montepulciano|sangiovese|merlot|cabernet|pinot|chardonnay|sauvignon|vermentino|moscato|lambrusco|primitivo|nebbiolo|barbera|trebbiano|rosato|rosso igt|bianco igt|rosso doc|bianco doc|frascati|verdicchio|soave|bardolino|valpolicella|vernaccia|cannonau|nero d.avola|franciacorta|asti |brut |cava |rose |lugana|gewurz|riesling|grillo|fiano|greco |lacrima|falanghina|aglianico|refosco|corvina|rondinella|garganega|muller|tai |blanc|rouge|chablis|bordeaux|bourgogne|beaujolais|sancerre|cotes du|chateau|dom perignon|veuve|ruinart)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'birre')
WHERE category_id IS NULL AND description ~* '(birra|beer|lager|ale |ipa |weiss|pilsner|stout|porter|peroni|moretti|heineken|beck|corona|ceres|ichnusa|nastro azzurro|leffe|hoegaarden|paulaner|franziskaner|warsteiner|budweiser|carlsberg|tuborg|guinness|tennent)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'liquori-distillati')
WHERE category_id IS NULL AND description ~* '(liquor|grappa|whisky|whiskey|vodka|gin |rum |brandy|cognac|amaro|limoncello|sambuca|nocino|mirto|assenzio|tequila|mezcal|bourbon|scotch|aperol|campari|spritz|martini |cinzano|fernet|averna|montenegro|jager|baileys|kahlua|cointreau|grand marnier|drambuie|chartreuse|cynar|strega|disaronno|amaretto|maraschino|bitter |vermouth|pastis|ouzo|calvados|armagnac|pisco|sake|hendrick|tanqueray|bombay|beefeater|bacardi|havana club|captain morgan|jack daniel|johnnie walker|chivas|jameson|absolut|belvedere|grey goose|smirnoff)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'bevande-analcoliche')
WHERE category_id IS NULL AND description ~* '(coca.col|pepsi|fanta|sprite|schweppes|san pellegrino|acqua |water|succo|juice|aranciata|limonata|chinotto|ginger|tonic|energy|redbull|red bull|monster|gatorade|powerade|estath|the |tea |tisana|infuso|bibita|bevanda|drink|soda|seltz|cedrata|crodino|sanbitter|lurisia|ferrarelle|levissima|panna |evian|vitasnella|fiuggi|uliveto|rocchetta|lete |vera |sant.anna|guizza|norda|lilia|fonte)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'caffe-te')
WHERE category_id IS NULL AND description ~* '(caff[eè]|coffee|espresso|cappuccin|moka|latte macch|nespresso|lavazza|illy |kimbo|borbone|segafredo|vergnano|pellini|corsini|mokambo|bialetti|decaffein|ciald[ae]|capsula|t[eè] |tea |the |infus|camomilla|tisana|orzo solub|ginseng)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'carne-salumi')
WHERE category_id IS NULL AND description ~* '(manzo|vitello|bovino|pollo|tacchino|maiale|suino|agnello|coniglio|anatra|quaglia|faraona|piccione|bresaola|prosciutt|salame|salumi|salsiccia|wurstel|mortadella|coppa|pancetta|guanciale|lardo|speck|lonza|cotechino|zampone|hamburger|polpett|arrost|bistecca|fiorentina|tagliata|carpaccio|tartare|braciola|costata|filetto|lombata|scamone|girello|fesa |noce |sottofesa|petto |coscia|aletta|bacon|arrosto|stinco|ossobuco|bollito|carne |meat|pett\.pollo|pett\. pollo|salsic)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'pesce-frutti-mare')
WHERE category_id IS NULL AND description ~* '(pesce|fish|salmone|tonno|merluzzo|baccal|orata|branzino|spigola|sogliola|trota|sardina|acciuga|alice |gambero|gamber|scampo|aragosta|astice|polpo|calamaro|seppia|cozza|vongola|ostrica|riccio|granchio|surimi|pangasio|persico|halibut|cernia|dentice|sarago|ricciola|pesce spada|rana pesc|trancia|crostace|mollusc|frutti.*(mare|di mare))';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'latticini-formaggi')
WHERE category_id IS NULL AND description ~* '(latte |milk|formagg|cheese|mozzarell|burrata|ricotta|mascarpone|parmigian|grana padano|pecorino|gorgonzola|taleggio|fontina|asiago|provolone|emmental|gruyere|cheddar|brie|camembert|roquefort|stilton|scamorza|caciocavallo|burro|butter|panna |cream|yogurt|stracchino|squacquerone|robiola|crescenza|philadelphia|kefir|skyr|latticin|caseari)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'uova')
WHERE category_id IS NULL AND description ~* '(^uov[aoe]|[^a-z]uov[aoe]|egg[s ]|frittata|omelette|albume|tuorlo)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'pasta-riso-cereali')
WHERE category_id IS NULL AND description ~* '(pasta |spaghett|penne|fusilli|rigatoni|tagliatell|fettuccin|lasagn|gnocchi|ravioli|tortellini|tortelloni|cannelloni|paccheri|orecchiett|farfalle|conchiglie|maccheroni|bucatini|linguine|pappardelle|vermicelli|capellini|bavette|trofie|caserecce|strozzapreti|maltagliati|garganelli|mezze maniche|riso |risotto|arborio|carnaroli|basmati|jasmine|cereali|corn.flake|muesli|granola|farro|orzo |avena|quinoa|cous.?cous|bulgur|polenta|semola|semolino|couscous)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'pane-prodotti-forno')
WHERE category_id IS NULL AND description ~* '(pane |bread|panino|grissino|cracker|fetta biscott|bruschett|focaccia|piadina|ciabatta|baguette|croissant|cornetto|brioche|muffin|pancake|waffle|toast|tramezzin|crostino|tarallo|frisella|pan carr|pan bauletto|pan grattug|pangrattat|lievito|farina |flour|impast)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'frutta-verdura')
WHERE category_id IS NULL AND description ~* '(frutta|fruit|mela |mele |pera |pere |banana|arancia|arancio|limone|pompelmo|mandarino|clementina|kiwi|ananas|mango|papaya|cocco|fragol|ciliegia|pesca |pesche|albicocc|susina|prugna|fico |fichi |melograno|cachi|nespola|lampone|mirtillo|ribes|mora |more |uva |uvetta|sultanin|dattero|mandorla|noce |noci |nocciola|pistacchi|castagna|pinoli|arachid|verdur|vegetab|insalata|lattuga|rucola|spinac|bietola|catalogna|cicoria|cavolo|cavolfiore|broccol|verza|cappuccio|carciofo|asparag|zucchina|zucchine|melanzana|peperone|peperoni|pomodor|tomat|cipolla|aglio|porro|sedano|carota|patata|fungo|funghi|champignon|porcini|radicchio|finocchio|cetriolo|ravanello|barbabieto|fagiol|pisell|lenticch|cece |ceci |fava |fave |soia|edamame|olive|oliva)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'dolci-pasticceria')
WHERE category_id IS NULL AND description ~* '(dolce|dessert|torta|cake|gelato|ice.cream|sorbetto|biscott|cookie|cioccolat|chocol|cacao|crem[ae]|budino|panna.cotta|tiramisu|profiterol|mousse|meringh|macaron|tartufo|cannolo|sfogliatella|bab[aà]|pastiera|colomba|panettone|pandoro|pralin|fondente|gianduja|nocciol|zucchero|sugar|miele|honey|marmellata|jam|confettura|sciroppo|syrup|wafer|snack.*dolc|barretta|nutella|crema.*nocc|glassa|topping|granella|decoraz.*torta|candito|amaretti)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'condimenti-conserve')
WHERE category_id IS NULL AND description ~* '(olio |oil|aceto|vinegar|sale |salt|pepe |pepper|spezia|spice|senape|mustard|ketchup|maionese|mayonnaise|salsa|sauce|pesto|sugo|ragù|ragu|passata|pelati|polpa.*pomodor|concentrato|estratto|dado|brodo|stock|bouillon|capperi|olive.*tavola|sottaceti|sottoli|giardiniera|worcester|tabasco|soy sauce|salsa.*soia|curry|curcuma|paprika|origano|basilico|rosmarino|timo|prezzemolo|maggiorana|salvia|alloro|cannella|cinnamon|vaniglia|vanilla|noce.*moscat|zafferano|chiodi.*garofano|anice|cumino|coriandolo|zenzero|ginger)';

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'pulizia-monouso')
WHERE category_id IS NULL AND description ~* '(detersiv|detergent|sapone|soap|igienizz|sanific|disinfett|candeggina|bleach|ammorbid|brillant|sgrassat|anticalc|pulito|cleaner|spugna|sponge|panno|straccio|mop|scopa|paletta|sacchetto|busta|pellicola|alluminio|carta.*forno|carta.*asciug|carta.*igien|tovagliolo|napkin|piatto.*carta|piatto.*plast|bicchier.*carta|bicchier.*plast|posata|forchetta|coltello|cucchiaio|cannuccia|straw|guanto|glove|cuffia|retina|grembiule|monouso|disposab|usa.*getta)';

-- Remaining go to "Altro"
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'altro')
WHERE category_id IS NULL;
