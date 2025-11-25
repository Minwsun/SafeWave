from PIL import Image
img = Image.open('map.png')
px = img.getpixel((img.width//2, img.height//2))
print('center', px)
print('width', img.width)
