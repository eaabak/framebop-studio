/**
 * Words ignored when grouping comments by topic: the most common words of a
 * few languages, and generic reactions that say how someone felt rather than
 * what they talked about. Short words (under three letters) are ignored
 * anyway, so they are not listed.
 */
const ENGLISH = `
about above after again against all also am and any are aren arent because
been before being below between both but can cant could couldn did didn didnt
does doesn doesnt doing don dont down during each even ever every few for from
further get gets getting got had hadn has hasn have haven having her here hers
herself him himself his how however into isn isnt its itself just let lets
like made make makes many may more most much must mustn myself need never
nor not now off once one only other our ours ourselves out over own really
same say says said see seen shan she should shouldn since some still such
than that thats the their theirs them themselves then there theres these
they theyre thing things think this those though through too under until
upon very was wasn wasnt way well were weren what whats when where which
while who whom whose why will with won wont would wouldn yeah yes yet you
youd youll your youre yours yourself yourselves going gonna want wanna
something anything everything nothing someone anyone everyone people time
times know back first new day years year actually literally always lot
`;

const TURKISH = `
acaba ama ancak artık aslında bana bazı belki ben benden beni benim bile bir
biraz birçok birkaç birşey biz bize bizi bizim böyle bu buna bunda bundan
bunu bunun burada çok çünkü daha değil diye dolayı defa en fakat falan gibi
göre hem hep hepsi her hiç için ile ise işte kadar kendi kendine ki kim kimse
mı mi mu mü nasıl ne neden nerede neyse niye olan olarak oldu olduğu olsa
olur ona onlar onları onu onun orada öyle sadece sanki şey şimdi şöyle şu
şuna şunu tabi tüm var veya ya yani yine yok zaten zira sen seni senin siz
sizi sizin bunlar şunlar onlara bence gerçekten hala hâlâ
`;

const SPANISH = `
algo algunos ante antes aquí cada como con contra cual cuando del desde
donde durante ella ellas ellos entre era eres esa esas ese eso esos esta
está están estas este esto estos fue fueron hay hasta las les los más mis
mucho muy nada nos nosotros otra otro para pero poco por porque que qué
quien sea ser sin sobre son soy sus también tan tanto tiene todo todos una
uno unos usted vez ya
`;

const GERMAN = `
aber alle allem allen aller als also auch auf aus bei bin bis bist das dass
dein deine dem den der des die dies diese dieser dir doch dort durch ein eine
einem einen einer eines euch für hab habe haben hat hatte ich ihm ihn ihr ihre
immer ist jetzt kann kein keine man mehr mein meine mich mir mit nach nicht
noch nur oder schon sein seine sich sie sind über und uns unser von vor war
was weil wenn wer wie wir wird wurde zum zur zwar
`;

const FRENCH = `
aux avec avoir bien car ce cela ces cet cette comme dans des donc elle elles
est été être fait faire ils les leur lui mais même mes moi mon nos notre nous
par pas peu peut plus pour quand que quel quelle qui sans ses son sont sur
tes toi ton tous tout très une vos votre vous
`;

const PORTUGUESE = `
ainda até com como das dele dela depois dos ela elas ele eles essa esse esta
este estou foi isso isto já lhe mais mas mesmo meu minha muito nada não nem
nos num numa para pela pelo por porque quando que quem sem ser seu sua são
também tem tenho uma você vocês
`;

/** Platform words that appear under almost every video. */
const PLATFORM = `
video videos vídeo vídeos channel channels youtube watch watching watched
subscribe subscribed subscriber subscribers comment comments content
kanal izledim izliyorum abone
`;

/** Generic reactions, which are not topics. */
const REACTIONS = `
love loved loving great good nice amazing awesome best better beautiful cool
thanks thank wow lol omg haha hahaha bravo perfect wonderful excellent
incredible fantastic super favorite favourite helpful glad happy
harika güzel teşekkürler teşekkür süper mükemmel muhteşem efsane bayıldım
gracias genial excelente increíble danke toll merci génial obrigado incrível
`;

export const IGNORED_WORDS: ReadonlySet<string> = new Set(
  [ENGLISH, TURKISH, SPANISH, GERMAN, FRENCH, PORTUGUESE, PLATFORM, REACTIONS]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean),
);
